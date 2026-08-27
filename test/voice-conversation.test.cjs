const assert = require('node:assert/strict');
const test = require('node:test');
const { generateAiResponse, synthesizeSpeech } = require('../electron/voice-conversation.cjs');

test('voice conversation sends greetings to the low-cost Luna model', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Hi! Nice to meet you.' } }] }) };
  };

  const response = await generateAiResponse({ apiKey: 'test-key', transcript: 'Hi', fetchImpl });

  assert.equal(request.model, 'openai/gpt-5.6-luna');
  assert.equal(request.messages.at(-1).content, 'Hi');
  assert.match(request.messages[0].content, /Luna/);
  assert.equal(response.text, 'Hi! Nice to meet you.');
});

test('voice conversation uses a current low-cost TTS model and returns audio bytes', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };

  const response = await synthesizeSpeech({ apiKey: 'test-key', text: 'Hi there.', fetchImpl });

  assert.equal(request.model, 'hexgrad/kokoro-82m');
  assert.equal(request.voice, 'af_heart');
  assert.equal(response.audioBase64, 'AQID');
  assert.equal(response.mimeType, 'audio/mpeg');
});

test('voice conversation preserves recent turns for dialogue continuity', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'That sounds interesting.' } }] }) };
  };

  await generateAiResponse({ apiKey: 'test-key', transcript: 'I am building a voice app.', history: [{ speaker: 'you', text: 'I am testing the conversation.' }, { speaker: 'luna', text: 'What are you working on?' }], fetchImpl });

  assert.deepEqual(request.messages.slice(-3).map((message) => [message.role, message.content]), [['user', 'I am testing the conversation.'], ['assistant', 'What are you working on?'], ['user', 'I am building a voice app.']]);
});
