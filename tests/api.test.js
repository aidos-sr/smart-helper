import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.OPENROUTER_API_KEY = 'test-only-not-a-key';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-only-not-a-key';
const { default: handler } = await import('../api/chat.js');
const originalFetch = globalThis.fetch;
let modelResponse, requests, refunds, reservations;
const encode = (data) => `data: ${JSON.stringify(data)}\n\n`;
const stream = (text, finish = 'stop') => new Response(
  encode({ model: 'test-model', choices: [{ delta: { content: text }, finish_reason: null }] }) +
  (finish ? encode({ choices: [{ delta: {}, finish_reason: finish }] }) : ''),
  { headers: { 'content-type': 'text/event-stream' } }
);
const json = (value) => Response.json(value);

beforeEach(() => {
  requests = []; refunds = 0; reservations = 0;
  modelResponse = () => stream('Дұрыс жауап');
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return json({ id: 'user-1', aud: 'authenticated', app_metadata: {}, user_metadata: {} });
    if (url.includes('/rpc/consume_ai_quota')) { reservations++; return json([{ allowed: true, minute_remaining: 9, daily_remaining: 49 }]); }
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
test('invalid study output is rejected after bounded repairs on every fallback', async () => {
  modelResponse = () => json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ cards: [] }) } }] });
  const res = await invoke({ task: 'flashcards', topic: 'Physics' });
  assert.equal(res.statusCode, 502);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => request.response_format.type === 'json_object'));
  assert.ok(requests.every((request) => request.reasoning.enabled === false));
  assert.equal(refunds, 1);
});
test('non-streaming length stops cannot be returned as successful translations', async () => {
  modelResponse = () => json({ choices: [{ finish_reason: 'length', message: { content: 'Half a translation' } }] });
  const res = await invoke({ task: 'trans', input: 'Long source text', targetLanguage: 'English' });
  assert.equal(res.statusCode, 502);
  assert.equal(refunds, 1);
  assert.equal(res.payload.text, undefined);
  assert.ok(requests.length <= 3);
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

const getSchema = (request) => JSON.parse(request.messages.find((message) => message.content.includes('Follow this schema exactly: ')).content.split('Follow this schema exactly: ')[1]);
const completeJSON = (data) => stream(JSON.stringify(data));
const question = (i) => ({ q: `Сұрақ ${i}?`, opts: ['Бір', 'Екі', 'Үш', 'Төрт'], correct: 0, explanation: 'Бір — дұрыс жауап.' });

test('30-day planner streams six small batches with progress and consumes one quota', async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.days.minItems;
    const start = Number(request.messages.at(-1).content.match(/(\d+)–\d+ күндеріне/)[1]);
    return completeJSON({ days: Array.from({ length: count }, (_, i) => ({ day: i + 1, title: `Күн ${start + i}`, tasks: 'Есеп шығар', subject: 'math' })) });
  };
  const res = await invoke({ task: 'planner', topic: 'Алгебра', days: 30, hours: 2, stream: true });
  const received = events(res);
  assert.equal(received.at(-1).type, 'done');
  assert.deepEqual(received.at(-1).data.days.map((day) => day.day), Array.from({ length: 30 }, (_, i) => i + 1));
  assert.equal(received.at(-1).data.days[25].title, 'Күн 26');
  assert.equal(requests.length, 6);
  assert.equal(reservations, 1);
  assert.equal(refunds, 0);
  assert.ok(received.some((event) => event.type === 'progress' && event.completed === 10 && event.total === 30));
});
test('15-question quiz avoids previous batches and returns exactly 15 usable questions', async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(request.messages.at(-1).content.match(/сұрақтың (\d+)–/)[1]);
    if (start > 1) assert.ok(request.messages.at(-1).content.includes('сұрақ 1?'));
    return completeJSON({ questions: Array.from({ length: count }, (_, i) => question(start + i)) });
  };
  const res = await invoke({ task: 'quiz', topic: 'Атом', count: 15, stream: true });
  assert.equal(events(res).at(-1).type, 'done');
  assert.equal(events(res).at(-1).data.questions.length, 15);
  assert.equal(requests.length, 3);
  assert.equal(reservations, 1);
});
test('non-multiple-of-five quiz counts validate a short final batch', async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(request.messages.at(-1).content.match(/сұрақтың (\d+)–/)[1]);
    return completeJSON({ questions: Array.from({ length: count }, (_, i) => question(start + i)) });
  };
  const res = await invoke({ task: 'quiz', topic: 'Атом', count: 6 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.questions.length, 6);
  assert.equal(requests.length, 2);
});
test('flashcards succeed even if provider rejects response_format', async () => {
  modelResponse = (request) => request.response_format
    ? new Response('{}', { status: 400 })
    : completeJSON({ cards: Array.from({ length: 6 }, (_, i) => ({ q: `Термин ${i}`, a: `Анықтама ${i}` })) });
  const res = await invoke({ task: 'flashcards', topic: 'Информатика', stream: true });
  assert.equal(events(res).at(-1).data.cards.length, 6);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].response_format, undefined);
  assert.ok(requests[1].messages.some((message) => message.content.includes('"required":["q","a"]')));
});
test('all three text tools use the same bounded, streamed completion path', async () => {
  for (const task of ['sum', 'trans', 'fix']) {
    const res = await invoke({ task, input: 'Мен мектепке барамын.', stream: true });
    assert.equal(events(res).at(-1).text, 'Дұрыс жауап');
    assert.equal(events(res).at(-1).type, 'done');
  }
  assert.equal(requests.length, 3);
});
test('an invalid final study batch never returns a partial result as success', async () => {
  modelResponse = (request) => {
    const count = getSchema(request).properties.questions.minItems;
    const start = Number(request.messages.find((message) => message.role === 'user').content.match(/сұрақтың (\d+)–/)[1]);
    return completeJSON({ questions: start === 1 ? Array.from({ length: count }, (_, i) => question(i + 1)) : [] });
  };
  const res = await invoke({ task: 'quiz', topic: 'Атом', count: 10, stream: true });
  assert.equal(events(res).at(-1).type, 'error');
  assert.equal(refunds, 1);
  assert.equal(reservations, 1);
  assert.ok(events(res).some((event) => event.type === 'progress' && event.completed === 5));
});
test('oversized tool input is rejected before quota or any provider request', async () => {
  const res = await invoke({ task: 'trans', input: 'Қ'.repeat(12001) });
  assert.equal(res.statusCode, 400);
  assert.equal(requests.length, 0);
  assert.equal(reservations, 0);
});
