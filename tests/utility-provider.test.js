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
    return calls.length === 1 ? Response.json({error:{message:'No endpoints found that support response_format'}}, { status: 404 }) : completion('{"answer":"ok"}');
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
    return payload.model === 'primary' ? Response.json({error:{code:429,metadata:{provider_name:'test-provider'}}}, { status: 429 }) : completion('{"answer":"ok"}');
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
test('a valid completed quiz does not time out while upstream cancellation hangs', async () => {
  const bytes = new TextEncoder().encode(event({ choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: null }] }) + event({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes); },
    cancel() { return new Promise(() => {}); }
  }), { headers: { 'content-type': 'text/event-stream' } });
  const result = await generateUtility(options(async () => response, { models: ['only'], attemptTimeoutMs: 30 }));
  assert.equal(result.data.answer, 'ok');
});
test('a timed-out model is not retried by later quiz batches', async () => {
  const cooldowns = new Map();
  const calls = [];
  const request = async (payload) => {
    calls.push(payload.model);
    return payload.model === 'primary'
      ? new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } })
      : completion('{"answer":"ok"}');
  };
  const outcomes = [];
  await generateUtility(options(request, { cooldowns, firstTokenTimeoutMs: 15, onAttempt: (event) => outcomes.push(event) }));
  await generateUtility(options(request, { cooldowns, firstTokenTimeoutMs: 15 }));
  assert.deepEqual(calls, ['primary', 'secondary', 'secondary']);
  assert.deepEqual(outcomes.map((event) => event.outcome), ['timeout', 'success']);
});
test('actual reasoning tokens keep an active quiz generation alive within its total budget', async () => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream({ start(controller) {
    for (const ms of [10, 20, 30]) setTimeout(() => controller.enqueue(encoder.encode(event({ choices: [{ delta: { reasoning: 'activity' } }] }))), ms);
    setTimeout(() => {
      controller.enqueue(encoder.encode(event({ choices: [{ delta: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }] })));
      controller.close();
    }, 40);
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const result = await generateUtility(options(async () => response, { models: ['only'], firstTokenTimeoutMs: 25, idleTimeoutMs: 25, attemptTimeoutMs: 150 }));
  assert.equal(result.data.answer, 'ok');
});
test('a rejected upstream with a stuck cancellation does not block a working fallback', async () => {
  let calls = 0;
  const blocked = () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}); } }), { status: 429 });
  const result = await generateUtility(options(async () => ++calls === 1 ? blocked() : completion('{"answer":"ok"}'), { attemptTimeoutMs: 50 }));
  assert.equal(result.data.answer, 'ok');
  assert.equal(calls, 2);
});
