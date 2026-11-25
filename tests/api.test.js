import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.OPENROUTER_API_KEY = 'test-only-not-a-key';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-not-a-key';
const { default: handler } = await import('../api/chat.js');
const originalFetch = globalThis.fetch;
let modelResponse, requests, refunds;
const encode = (data) => `data: ${JSON.stringify(data)}\n\n`;
const stream = (text, finish = 'stop') => new Response(
  encode({ model: 'test-model', choices: [{ delta: { content: text }, finish_reason: null }] }) +
  (finish ? encode({ choices: [{ delta: {}, finish_reason: finish }] }) : ''),
  { headers: { 'content-type': 'text/event-stream' } }
);
const json = (value) => Response.json(value);

beforeEach(() => {
  requests = []; refunds = 0;
  modelResponse = () => stream('Дұрыс жауап');
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return json({ id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {} });
    if (url.includes('/rpc/consume_ai_quota')) return json([{ allowed: true, minute_remaining: 9, daily_remaining: 49 }]);
    if (url.includes('/rest/v1/ai_usage')) {
      if (init?.method === 'PATCH') { refunds++; return json({ user_id: 'user-1' }); }
      return json({ day_key: new Date().toISOString().slice(0, 10), day_count: 1, minute_key: Math.floor(Date.now() / 60000), minute_count: 1 });
    }
    if (url === 'https://openrouter.ai/api/v1/chat/completions') {
      requests.push(JSON.parse(init.body));
      return modelResponse(requests.at(-1));
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

class ResponseMock extends EventEmitter {
  statusCode = 200; headersSent = false; writableEnded = false; headers = {}; chunks = [];
  setHeader(name, value) { assert.equal(this.headersSent, false); this.headers[name.toLowerCase()] = value; }
  status(code) { this.statusCode = code; return this; }
  json(payload) { this.payload = payload; this.headersSent = true; this.writableEnded = true; return this; }
  flushHeaders() { this.headersSent = true; }
  write(chunk) { assert.equal(this.writableEnded, false); this.chunks.push(chunk); }
  end() { this.writableEnded = true; }
}
async function invoke(body, headers = { authorization: 'Bearer test-session' }) {
  const res = new ResponseMock();
  await handler({ method: 'POST', headers, body }, res);
  return res;
}
const chat = { task: 'chat', stream: true, web: false, messages: [{ role: 'user', content: 'sin(30) неше?' }] };
const events = (res) => res.chunks.join('').split('\n\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));

test('handler authenticates, streams and completes without double-setting headers', async () => {
  const res = await invoke(chat);
  assert.equal(res.statusCode, 200);
  assert.equal(events(res).at(-1).type, 'done');
  assert.equal(events(res).at(-1).text, 'Дұрыс жауап');
  assert.equal(refunds, 0);
  assert.ok(requests[0].max_tokens >= 4000);
});
test('handler refunds quota after empty streams exhaust all fallbacks', async () => {
  modelResponse = () => new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const res = await invoke(chat);
  assert.equal(requests.length, 3);
  assert.equal(events(res).at(-1).type, 'error');
  assert.equal(refunds, 1);
});
test('handler keeps partial answers explicitly incomplete and does not mix models', async () => {
  modelResponse = () => stream('Жарты жауап', null);
  const res = await invoke(chat);
  assert.equal(requests.length, 1);
  assert.equal(events(res).at(-1).type, 'error');
  assert.equal(events(res).at(-1).partialText, 'Жарты жауап');
  assert.equal(refunds, 0);
});
test('handler falls back after an empty provider without sending headers twice', async () => {
  modelResponse = () => requests.length === 1
    ? new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    : stream('Резерв жауабы');
  const res = await invoke(chat);
  assert.equal(requests.length, 2);
  assert.equal(events(res).at(-1).type, 'done');
});
test('handler rejects unauthenticated and overlong input before charging quota', async () => {
  assert.equal((await invoke(chat, {})).statusCode, 401);
  assert.equal((await invoke({ ...chat, messages: [{ role: 'user', content: 'a'.repeat(12001) }] })).statusCode, 400);
  assert.equal(requests.length, 0);
});
test('structured requests require schema support on every fallback', async () => {
  modelResponse = () => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ cards: [] }) } }] });
  const res = await invoke({ task: 'flashcards', topic: 'Physics' });
  assert.equal(res.statusCode, 502);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.provider.require_parameters === true));
  assert.equal(refunds, 1);
});
test('non-streaming length stops cannot be returned as successful translations', async () => {
  modelResponse = () => json({ choices: [{ finish_reason: 'length', message: { content: 'Half a translation' } }] });
  const res = await invoke({ task: 'trans', input: 'Long source text', targetLanguage: 'English' });
  assert.equal(res.statusCode, 502);
  assert.equal(refunds, 1);
  assert.equal(requests[0].max_tokens, 8000);
  assert.equal(requests[1].max_tokens, 16000);
});
test('ordinary chat with web enabled skips external source lookup for greetings', async () => {
  const res = await invoke({ ...chat, web: true, messages: [{ role: 'user', content: 'Сәлем!' }] });
  assert.equal(events(res).at(-1).type, 'done');
  assert.equal(events(res)[0].webStatus, 'skipped');
  assert.deepEqual(requests[0].plugins, []);
});
test('deep web chat uses only provider search, without duplicate encyclopedic requests', async () => {
  const res = await invoke({ ...chat, deep: true, web: true, messages: [{ role: 'user', content: 'Latest science news' }] });
  assert.equal(events(res).at(-1).type, 'done');
  assert.equal(requests[0].plugins[0].id, 'web');
  assert.equal(events(res).at(-1).webStatus, 'no_results');
});
