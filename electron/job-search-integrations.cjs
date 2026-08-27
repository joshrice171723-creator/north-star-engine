const crypto = require('crypto');

const DEFAULT_N8N_TIMEOUT_MS = 10000;
const DEFAULT_LANGSMITH_ENDPOINT = 'https://api.smith.langchain.com';

function loadLangGraph() {
  // Lazy loading keeps Electron startup usable when dependencies are being
  // installed or rebuilt. The search path still fails clearly when the graph
  // is actually invoked without a complete npm install.
  try { return require('@langchain/langgraph'); }
  catch (cause) { throw new Error(`LangGraph is not installed correctly: ${cause.message}`); }
}

function loadLangChainOpenAI() {
  try { return require('@langchain/openai'); }
  catch (cause) { throw new Error(`LangChain OpenAI integration is not installed correctly: ${cause.message}`); }
}

function loadLangSmith() {
  try { return require('langsmith'); }
  catch (cause) { throw new Error(`LangSmith is not installed correctly: ${cause.message}`); }
}

function safeError(error) {
  return { name: error?.name || 'Error', message: error?.message || String(error) };
}

function publicConfig(env = process.env) {
  return {
    langChain: { configured: Boolean(env.OPENROUTER_API_KEY || env.LANGCHAIN_API_KEY), provider: 'OpenRouter via LangChain' },
    langGraph: { configured: true, workflow: 'job-search' },
    langSmith: { configured: Boolean(env.LANGCHAIN_API_KEY), project: env.LANGCHAIN_PROJECT || env.LANGCHAIN_PROJECT_NAME || 'hermes-job-search' },
    n8n: { configured: Boolean(env.N8N_JOB_SEARCH_WEBHOOK_URL), workflow: env.N8N_JOB_SEARCH_WORKFLOW_NAME || 'job-search-events' },
  };
}

function createLangChainOpenRouterModel({ apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini' } = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the LangChain model.');
  const { ChatOpenAI } = loadLangChainOpenAI();
  return new ChatOpenAI({
    apiKey,
    model,
    temperature: 0.3,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: { 'X-Title': 'Hermes Job Search' },
    },
  });
}

function createLangChainChatAdapter({ model } = {}) {
  if (!model || typeof model.invoke !== 'function') throw new Error('A LangChain chat model is required.');
  return async (messages, options = {}) => {
    const response = await model.invoke(messages, options);
    const content = typeof response?.content === 'string'
      ? response.content
      : Array.isArray(response?.content)
        ? response.content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
        : JSON.stringify(response?.content ?? '');
    return { ok: true, message: { content }, model: response?.response_metadata?.model_name || undefined, usage: response?.usage_metadata || null };
  };
}

function createN8nEventClient({ env = process.env, fetchImpl = global.fetch, timeoutMs = DEFAULT_N8N_TIMEOUT_MS } = {}) {
  const webhookUrl = String(env.N8N_JOB_SEARCH_WEBHOOK_URL || '').trim();
  return {
    configured: Boolean(webhookUrl),
    async emit(event, payload = {}) {
      if (!webhookUrl) return { sent: false, reason: 'not_configured' };
      if (typeof fetchImpl !== 'function') return { sent: false, reason: 'fetch_unavailable' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(webhookUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          // Never send resumes, credentials, job descriptions, or raw model
          // prompts to n8n; workflows receive event metadata only.
          body: JSON.stringify({ event, occurredAt: new Date().toISOString(), ...payload }),
        });
        return { sent: response.ok, status: response.status };
      } catch (cause) {
        return { sent: false, reason: cause?.name === 'AbortError' ? 'timeout' : 'network_error' };
      } finally { clearTimeout(timer); }
    },
  };
}

function createLangSmithRunClient({ env = process.env, client } = {}) {
  const configured = Boolean(env.LANGCHAIN_API_KEY) && env.LANGCHAIN_TRACING_V2 !== 'false';
  let langsmith = client;
  return {
    configured,
    async start({ runId, inputs, metadata = {} }) {
      if (!configured) return null;
      if (!langsmith) { const { Client } = loadLangSmith(); langsmith = new Client({ apiKey: env.LANGCHAIN_API_KEY, apiUrl: env.LANGCHAIN_ENDPOINT || DEFAULT_LANGSMITH_ENDPOINT }); }
      await langsmith.createRun({ id: runId, name: 'north-star-job-search', run_type: 'chain', project_name: env.LANGCHAIN_PROJECT || env.LANGCHAIN_PROJECT_NAME || 'north-star-job-search', inputs, extra: { metadata } });
      return runId;
    },
    async end({ runId, outputs, error }) {
      if (!configured || !langsmith || !runId) return;
      await langsmith.updateRun(runId, { outputs: error ? undefined : outputs, error: error ? JSON.stringify(safeError(error)) : undefined, end_time: Date.now() });
    },
  };
}

function createJobSearchGraph({ planner, retriever, ranker, n8n = createN8nEventClient(), langsmith = createLangSmithRunClient() }) {
  if (typeof planner !== 'function' || typeof retriever !== 'function' || typeof ranker !== 'function') throw new Error('Job search graph requires planner, retriever, and ranker functions.');
  const { StateGraph, Annotation, START, END } = loadLangGraph();
  const State = Annotation.Root({ input: Annotation(), plan: Annotation(), found: Annotation(), ranked: Annotation(), error: Annotation(), runId: Annotation() });
  const graph = new StateGraph(State)
    .addNode('plan', async (state) => ({ plan: await planner(state.input), runId: state.runId }))
    .addNode('retrieve', async (state) => ({ found: await retriever({ ...state.input, plan: state.plan }), runId: state.runId }))
    .addNode('rank', async (state) => ({ ranked: await ranker({ ...state.input, plan: state.plan, found: state.found }), runId: state.runId }))
    .addEdge(START, 'plan')
    .addEdge('plan', 'retrieve')
    .addEdge('retrieve', 'rank')
    .addEdge('rank', END)
    .compile();
  return {
    async invoke(input) {
      const runId = input.runId || `job-search-${crypto.randomUUID()}`;
      await langsmith.start({ runId, inputs: { targetIntent: input.targetIntent || null }, metadata: { graph: 'job-search', framework: 'langgraph' } }).catch(() => {});
      await n8n.emit('job_search.started', { runId }).catch(() => {});
      try {
        const result = await graph.invoke({ input, runId });
        await langsmith.end({ runId, outputs: { resultCount: result.ranked?.length || result.found?.jobs?.length || 0 } }).catch(() => {});
        await n8n.emit('job_search.completed', { runId, resultCount: result.ranked?.length || result.found?.jobs?.length || 0 }).catch(() => {});
        return result;
      } catch (cause) {
        await langsmith.end({ runId, error: cause }).catch(() => {});
        await n8n.emit('job_search.failed', { runId, error: safeError(cause) }).catch(() => {});
        throw cause;
      }
    },
  };
}

module.exports = { createLangChainOpenRouterModel, createLangChainChatAdapter, createN8nEventClient, createLangSmithRunClient, createJobSearchGraph, publicConfig, safeError };
