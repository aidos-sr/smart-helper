import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUtility } from '../lib/utility-provider.js';

const event = (data) => `data: ${JSON.stringify(data)}\n\n`;
const completion = (text, finish_reason = 'stop') => new Response(event({ choices: [{ delta: { content: text }, finish_reason: null }] }) + event({ choices: [{ delta: {}, finish_reason }] }), { headers: { 'content-type': 'text/event-stream' } });
const options = (request, extra = {}) => ({
  modelRequest: { messages: [{ role: 'system', content: 'Tutor' }, { role: 'user', content: 'Test' }], max_tokens: 1000, response_format: { type: 'json_schema', json_schema: { schema: { type: 'object', required: ['answer'] } } } },
  models: ['primary', 'secondary'], request, deadline: Date.now() + 10000,
  validate(text) { const data = JSON.parse(text); if (data.answer !== 'ok') throw new Error('bad'); return { data }; }, ...extra
});
test('unsupported JSON format downgrades only transport, keeping schema and validation', async () => {
  const calls = [];
  const result = await generateUtility(options(async (payload) => {
    calls.push(payload);
    return calls.length === 1 ? new Response('{}', { status: 404 }) : completion('{"answer":"ok"}');
  }));
  assert.equal(result.data.answer, 'ok');
  assert.equal(calls[1].model, 'primary');
  assert.equal(calls[1].response_format, undefined);
  assert.ok(calls[1].messages.some((message) => message.content.includes('"required":["answer"]')));
});
test('invalid JSON gets one content repair before switching provider', async () => {
  let count = 0;
  const result = await generateUtility(options(async (payload) => {
    count++;
    if (count === 1) return completion('{"answer":');
    assert.equal(payload.model, 'primary');
    assert.equal(payload.messages.at(-2).role, 'assistant');
    return completion('{"answer":"ok"}');
  }));
  assert.equal(result.ok, true);
  assert.equal(count, 2);
});
test('stream errors and empty streams can fall back without delivering corrupt material', async () => {
  for (const broken of [() => new Response(event({ error: { code: 503 } }), { headers: { 'content-type': 'text/event-stream' } }), () => completion('')]) {
    let count = 0;
    const result = await generateUtility(options(async () => ++count === 1 ? broken() : completion('{"answer":"ok"}')));
    assert.equal(result.ok, true);
    assert.equal(count, 2);
  }
});
test('token-truncated JSON is regenerated with a sufficient budget, never patched into fake content', async () => {
  const calls = [];
  await generateUtility(options(async (payload) => {
    calls.push(payload);
    return calls.length === 1 ? completion('{"answer":', 'length') : completion('{"answer":"ok"}');
  }));
  assert.ok(calls[1].max_tokens > calls[0].max_tokens);
});
test('a stalled provider is bounded even if its fetch ignores cancellation', async () => {
  await assert.rejects(generateUtility(options(() => new Promise(() => {}), { models: ['only'], attemptTimeoutMs: 20 })), (error) => error.kind === 'timeout');
});
test('rate-limited models are skipped by later batches within the same task', async () => {
  const cooldowns = new Map();
  const calls = [];
  const request = async (payload) => {
    calls.push(payload.model);
    return payload.model === 'primary' ? new Response('{}', { status: 429 }) : completion('{"answer":"ok"}');
  };
  await generateUtility(options(request, { cooldowns }));
  await generateUtility(options(request, { cooldowns }));
  assert.deepEqual(calls, ['primary', 'secondary', 'secondary']);
});
test('disconnecting the browser aborts utility generation without starting another provider', async () => {
  const controller = new AbortController();
  let requests = 0;
  const promise = generateUtility(options(async (_payload, signal) => {
    requests++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(requests, 1);
});
test('plain text tools retry without unsupported optional reasoning controls', async () => {
  const calls = [];
  const result = await generateUtility(options(async (payload) => {
    calls.push(payload);
    return payload.reasoning ? new Response('{}', { status: 400 }) : completion('Translated');
  }, {
    modelRequest: { messages: [{ role: 'user', content: 'Translate' }], max_tokens: 1000 },
    validate: (text) => ({ text })
  }));
  assert.equal(result.text, 'Translated');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].reasoning, undefined);
});
