const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const VOICE_STT_MODEL = process.env.OPENROUTER_VOICE_STT_MODEL || 'openai/whisper-1';
// Use OpenRouter's stable Luna alias so this low-cost conversational model can
// receive provider updates without requiring a desktop-app release.
const VOICE_CHAT_MODEL = process.env.OPENROUTER_VOICE_CHAT_MODEL || 'openai/gpt-5.6-luna';
// TTS is a separate speech model: Luna creates the reply text, while Kokoro
// turns that text into playable audio. This current OpenRouter model is much
// cheaper than premium speech providers and exposes stable preset voices.
const VOICE_TTS_MODEL = process.env.OPENROUTER_VOICE_TTS_MODEL || 'hexgrad/kokoro-82m';
const VOICE_TTS_VOICE = process.env.OPENROUTER_VOICE_TTS_VOICE || 'af_heart';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 2_000;
const MAX_RESPONSE_CHARS = 2_000;

const VOICE_SYSTEM_PROMPT = 'You are Luna, a friendly conversational voice assistant. Reply naturally and briefly, as if speaking out loud. If the user says hello or hi, warmly greet them back and invite them to continue.';
const SUPPORTED_AUDIO_FORMATS = new Set(['webm', 'ogg', 'wav', 'mp3', 'm4a', 'aac']);

function requireApiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('OpenRouter is not configured. Add an API key in Profile & resume before starting the voice test.');
  return apiKey.trim();
}

function requestHeaders(apiKey) {
  return { Authorization: `Bearer ${requireApiKey(apiKey)}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://anthropic.skilljar.com/', 'X-Title': 'North Star Voice Test' };
}

async function readJsonResponse(response, fallback) {
  let body;
  try { body = await response.json(); } catch { throw new Error(fallback); }
  if (!response.ok) throw new Error(body?.error?.message || `OpenRouter request failed (${response.status}).`);
  return body;
}

function validAudioInput(input = {}) {
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  const format = String(input.format || '').trim().toLowerCase();
  if (!SUPPORTED_AUDIO_FORMATS.has(format)) throw new Error('The recorded audio format is not supported. Please try recording again.');
  if (!data) throw new Error('No audio was recorded. Please try again.');
  // Base64 expands bytes by roughly one third. Bound it before sending so a
  // forgotten recorder cannot create an unexpectedly large provider request.
  if (Buffer.byteLength(data, 'base64') > MAX_AUDIO_BYTES) throw new Error('That recording is too large. Please keep the voice test under a couple of minutes.');
  return { data, format };
}

async function requestTranscription({ apiKey, audio, fetchImpl = globalThis.fetch, maxChars = MAX_TRANSCRIPT_CHARS }) {
  const inputAudio = validAudioInput(audio);
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/audio/transcriptions`, { method: 'POST', headers: requestHeaders(apiKey), body: JSON.stringify({ model: VOICE_STT_MODEL, input_audio: inputAudio, language: 'en' }) });
  const body = await readJsonResponse(response, 'OpenRouter returned an unreadable transcription response.');
  const text = String(body?.text || '').trim();
  if (!text) throw new Error('The recording could not be transcribed. Please try speaking a little closer to your microphone.');
  return { text: text.slice(0, maxChars), model: VOICE_STT_MODEL };
}

async function transcribeAudio({ apiKey, audio, fetchImpl = globalThis.fetch }) {
  return requestTranscription({ apiKey, audio, fetchImpl, maxChars: MAX_TRANSCRIPT_CHARS });
}

async function transcribeAudioLong({ apiKey, audio, fetchImpl = globalThis.fetch }) {
  // Video Factory sends short audio segments one at a time, so the existing
  // 12 MB request guard remains in place while each response can stay complete.
  return requestTranscription({ apiKey, audio, fetchImpl, maxChars: 100_000 });
}

async function generateAiResponse({ apiKey, transcript, history = [], fetchImpl = globalThis.fetch }) {
  const text = typeof transcript === 'string' ? transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS) : '';
  if (!text) throw new Error('There is no transcription to send to the assistant.');
  // Keep a small rolling window so Luna can refer to what was said earlier
  // without sending an unbounded transcript on every turn.
  const priorMessages = Array.isArray(history) ? history.slice(-10).flatMap((entry) => {
    const content = typeof entry?.text === 'string' ? entry.text.trim().slice(0, MAX_RESPONSE_CHARS) : '';
    if (!content) return [];
    return [{ role: entry.speaker === 'luna' ? 'assistant' : 'user', content }];
  }) : [];
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, { method: 'POST', headers: requestHeaders(apiKey), body: JSON.stringify({ model: VOICE_CHAT_MODEL, messages: [{ role: 'system', content: VOICE_SYSTEM_PROMPT }, ...priorMessages, { role: 'user', content: text }], temperature: 0.5, max_tokens: 100 }) });
  const body = await readJsonResponse(response, 'OpenRouter returned an unreadable assistant response.');
  const assistantText = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!assistantText) throw new Error('Luna returned no usable response. Please try again.');
  return { text: assistantText.slice(0, MAX_RESPONSE_CHARS), model: VOICE_CHAT_MODEL };
}

async function synthesizeSpeech({ apiKey, text, fetchImpl = globalThis.fetch }) {
  const input = typeof text === 'string' ? text.trim().slice(0, MAX_RESPONSE_CHARS) : '';
  if (!input) throw new Error('There is no assistant response to speak.');
  const response = await fetchImpl(`${OPENROUTER_BASE_URL}/audio/speech`, { method: 'POST', headers: requestHeaders(apiKey), body: JSON.stringify({ model: VOICE_TTS_MODEL, input, voice: VOICE_TTS_VOICE, response_format: 'mp3' }) });
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch {}
    throw new Error(body?.error?.message || `OpenRouter speech generation failed (${response.status}).`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length) throw new Error('OpenRouter generated an empty audio response. Please try again.');
  return { audioBase64: audio.toString('base64'), mimeType: response.headers.get('content-type') || 'audio/mpeg', model: VOICE_TTS_MODEL, voice: VOICE_TTS_VOICE };
}

module.exports = { VOICE_STT_MODEL, VOICE_CHAT_MODEL, VOICE_TTS_MODEL, VOICE_TTS_VOICE, transcribeAudio, transcribeAudioLong, generateAiResponse, synthesizeSpeech };
