import test from 'node:test';
import assert from 'node:assert/strict';
import { readSSEData } from '../lib/sse.js';
import { consumeAIStream } from '../lib/ai-client-stream.js';
import { generateChatStream } from '../lib/ai-stream.js';

const encoder = new TextEncoder();
const event = (data, newline = '\n') => `data: ${JSON.stringify(data)}${newline}${newline}`;
const delta = (text, extra = {}) => ({ choices: [{ delta: { content: text }, finish_reason: null }], ...extra });
const finish = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] });
function body(text, byteSize = 7) {
  const bytes = encoder.encode(text);
  return new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += byteSize) controller.enqueue(bytes.slice(i, i + byteSize));
    controller.close();
  } });
}
const upstream = (text) => new Response(body(text), { headers: { 'Content-Type': 'text/event-stream' } });
const answer = (text = 'Толық жауап') => upstream(event(delta(text)) + event(finish('stop')) + 'data: [DONE]\n\n');
const options = (request, extra = {}) => ({
  attempts: [{ model: 'primary' }, { model: 'backup' }],
  modelRequest: { messages: [{ role: 'user', content: 'Сұрақ' }], max_tokens: 4000 },
  request, onEvent() {}, ...extra
});

test('SSE preserves Kazakh UTF-8, split CRLF, comments, multiline data', async () => {
  const stream = body(': ping\r\n\r\ndata: Қазақ\r\ndata: тілі\r\n\r\ndata: соңғы\r\n\r\n', 1);
  const values = [];
  for await (const data of readSSEData(stream)) values.push(data);
  assert.deepEqual(values, ['Қазақ\nтілі', 'соңғы']);
});
test('SSE does not execute unterminated final events', async () => {
  const values = [];
  for await (const data of readSSEData(body('data: incomplete'))) values.push(data);
  assert.deepEqual(values, []);
});
test('client merges metadata and completes exactly once on explicit done', async () => {
  let done = 0;
  const result = await consumeAIStream(body(event({ type: 'meta', sources: [{ url: 'https://example.org' }] }) +
    event({ type: 'meta', model: 'backup' }) + event({ type: 'delta', text: 'Қазақша' }) +
    event({ type: 'done', text: 'Қазақша жауап', finishReason: 'stop' })), { onDone() { done++; } });
  assert.equal(done, 1);
  assert.equal(result.text, 'Қазақша жауап');
  assert.equal(result.sources.length, 1);
  assert.equal(result.model, 'backup');
});
test('client preserves partial text and rejects silent EOF', async () => {
  let done = false;
  await assert.rejects(consumeAIStream(body(event({ type: 'delta', text: 'Бірінші бөлігі' })), {
    onDone() { done = true; }
  }), (error) => error.partialText === 'Бірінші бөлігі');
  assert.equal(done, false);
});
test('client preserves partial text on explicit server error', async () => {
  await assert.rejects(consumeAIStream(body(event({ type: 'delta', text: 'Жауап' }) +
    event({ type: 'error', code: 'timeout', error: 'Уақыт бітті' }))),
  (error) => error.partialText === 'Жауап' && error.code === 'timeout');
});
test('client exposes incomplete token-limited results', async () => {
  const result = await consumeAIStream(body(event({ type: 'done', text: 'Жартысы', incomplete: true })));
  assert.equal(result.incomplete, true);
});
test('client stops at done without waiting for transport EOF', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(event({ type: 'done', text: 'Дайын' }))); },
    cancel() { cancelled = true; }
  });
  assert.equal((await consumeAIStream(stream)).text, 'Дайын');
  assert.equal(cancelled, true);
});
test('client rejects malformed SSE JSON', async () => {
  await assert.rejects(consumeAIStream(body('data: {broken}\n\n')));
});
test('aborting a pending stream read cancels its reader', async () => {
  const controller = new AbortController();
  const promise = consumeAIStream(new ReadableStream({}), {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});
test('provider streams a complete answer and reports actual routed model', async () => {
  const events = [];
  const result = await generateChatStream(options(async () => upstream(
    event(delta('Жауап', { model: 'actual-model' })) + event(finish('stop'))
  ), { onEvent: (event) => events.push(event) }));
  assert.equal(result.ok, true);
  assert.equal(result.model, 'actual-model');
  assert.equal(result.incomplete, false);
  assert.equal(events[0].model, 'actual-model');
});
test('provider falls back on rate limit before any answer', async () => {
  const models = [];
  const result = await generateChatStream(options(async ({ model }) => {
    models.push(model);
    return model === 'primary' ? new Response('{}', { status: 429 }) : answer();
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(models, ['primary', 'backup']);
});
test('empty and HTTP-200 error streams fall back before visible text', async () => {
  for (const response of [() => upstream('data: [DONE]\n\n'), () => upstream(event({ error: { message: 'busy' } }))]) {
    let count = 0;
    const result = await generateChatStream(options(async () => ++count === 1 ? response() : answer()));
    assert.equal(result.ok, true);
    assert.equal(count, 2);
  }
});
test('EOF or DONE without finish reason cannot mark partial answer complete', async () => {
  for (const suffix of ['', 'data: [DONE]\n\n']) {
    let calls = 0;
    const result = await generateChatStream(options(async () => { calls++; return upstream(event(delta('Жарты')) + suffix); }));
    assert.equal(result.ok, false);
    assert.equal(result.text, 'Жарты');
    assert.equal(calls, 1);
  }
});
test('midstream errors preserve text and do not switch models', async () => {
  let calls = 0;
  const result = await generateChatStream(options(async () => {
    calls++;
    return upstream(event(delta('Сақталады')) + event({ choices: [{ finish_reason: 'error' }] }));
  }));
  assert.equal(result.ok, false);
  assert.equal(result.hadDelta, true);
  assert.equal(result.text, 'Сақталады');
  assert.equal(calls, 1);
});
test('length termination continues on the same model with the partial answer', async () => {
  const calls = [];
  const result = await generateChatStream(options(async (input) => {
    calls.push(input);
    return calls.length === 1 ? upstream(event(delta('Басы ')) + event(finish('length'))) : answer('соңы');
  }));
  assert.equal(result.text, 'Басы соңы');
  assert.equal(result.incomplete, false);
  assert.deepEqual(calls.map((call) => call.model), ['primary', 'primary']);
  assert.equal(calls[1].messages.at(-2).content, 'Басы ');
});
test('automatic continuation is bounded and flags another length stop', async () => {
  let calls = 0;
  const result = await generateChatStream(options(async () => { calls++; return upstream(event(delta('Келесі ')) + event(finish('length'))); }));
  assert.equal(calls, 2);
  assert.equal(result.incomplete, true);
  assert.equal(result.finishReason, 'length');
});
test('almost exhausted request budget leaves a continuation flag', async () => {
  let calls = 0;
  const result = await generateChatStream(options(async () => { calls++; return upstream(event(delta('Мәтін')) + event(finish('length'))); }, { deadline: Date.now() + 4000 }));
  assert.equal(calls, 1);
  assert.equal(result.incomplete, true);
});
test('idle timeout keeps partial text instead of throwing the answer away', async () => {
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(event(delta('Сақталды'))));
  } }), { headers: { 'content-type': 'text/event-stream' } });
  const result = await generateChatStream(options(async () => response, { idleTimeoutMs: 20 }));
  assert.equal(result.kind, 'timeout');
  assert.equal(result.text, 'Сақталды');
});
test('first-answer timeout can fall back while overall budget remains', async () => {
  let calls = 0;
  const result = await generateChatStream(options(async () => {
    calls++;
    return calls === 1 ? new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } }) : answer();
  }, { firstTokenTimeoutMs: 20 }));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});
test('client cancellation prevents fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = generateChatStream(options(async () => {
    calls++;
    return new Response(new ReadableStream({}), { headers: { 'content-type': 'text/event-stream' } });
  }, { signal: controller.signal }));
  setTimeout(() => controller.abort(), 10);
  const result = await promise;
  assert.equal(result.kind, 'cancelled');
  assert.equal(calls, 1);
});
test('web citations come from provider annotations, with unsafe URLs excluded', async () => {
  const result = await generateChatStream(options(async () => upstream(event({ choices: [{
    delta: { content: 'Дерек', annotations: [
      { type: 'url_citation', url_citation: { title: 'Бет', url: 'https://example.org/source' } },
      { type: 'url_citation', url_citation: { title: 'Unsafe', url: 'javascript:alert(1)' } }
    ] }
  }] }) + event(finish('stop')))));
  assert.deepEqual(result.sources, [{ title: 'Бет', url: 'https://example.org/source' }]);
});
test('continuation boundaries preserve whitespace instead of joining words', async () => {
  const result = await consumeAIStream(body(event({ type: 'delta', text: 'басы ' }) + event({ type: 'error', error: 'test' }))).catch((error) => error);
  assert.equal(result.partialText, 'басы ');
  const complete = await consumeAIStream(body(event({ type: 'done', text: ' соңы' })));
  assert.equal(complete.text, ' соңы');
});
