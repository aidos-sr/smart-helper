import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIClient } from '../lib/ai-http.js';
import { createMaterialCache } from '../lib/material-cache.js';
import { withDeadline } from '../lib/deadline.js';
import { splitToolText } from '../lib/study-generation.js';

const cards = Array.from({ length: 6 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
const event = (data) => `data: ${JSON.stringify(data)}\n\n`;
const sse = (data) => new Response(data, { headers: { 'content-type': 'text/event-stream' } });
const client = (fetchImpl, refreshSession = async () => {}) => createAIClient({ getAccessToken: () => 'test-session', refreshSession, fetchImpl });

test('study client reads structured done events and real progress without expecting text', async () => {
  const progress = [];
  const response = await client(async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    return sse(event({ type: 'progress', completed: 3, total: 6, unit: 'cards' }) + event({ type: 'done', data: { cards } }));
  }).send('flashcards', { topic: 'Test' }, { onProgress: (event) => progress.push(event) });
  assert.equal(response.data.cards.length, 6);
  assert.equal(progress[0].completed, 3);
});
test('study client rejects incomplete successful HTTP/JSON responses', async () => {
  await assert.rejects(client(async () => Response.json({ data: { cards: cards.slice(0, 5) } })).send('flashcards', { topic: 'Test' }), /толық алынбады/);
});
test('study client still accepts valid JSON from a previous server deployment', async () => {
  const response = await client(async () => Response.json({ data: { cards } })).send('flashcards', {});
  assert.equal(response.data.cards.length, 6);
});
test('an HTTP fetch ignoring AbortSignal cannot leave the Generate button pending forever', async () => {
  await assert.rejects(client(() => new Promise(() => {})).send('fix', { input: 'Test' }, {}, { timeoutMs: 20 }), /уақыты аяқталды/);
});
test('stalled response body and stalled token refresh have a whole-operation deadline', async () => {
  await assert.rejects(client(async () => sse(new ReadableStream({}))).send('fix', { input: 'Test' }, {}, { timeoutMs: 20 }), /уақыты аяқталды/);
  await assert.rejects(client(async () => new Response('{}', { status: 401 }), () => new Promise(() => {})).send('fix', { input: 'Test' }, {}, { timeoutMs: 20 }), /уақыты аяқталды/);
});
test('expired sessions refresh once and then retry with the renewed session', async () => {
  let requests = 0, refreshes = 0;
  const response = await client(async () => ++requests === 1 ? new Response('{}', { status: 401 }) : sse(event({ type: 'done', text: 'Дайын' })), async () => { refreshes++; }).send('fix', { input: 'Test' });
  assert.equal(response.text, 'Дайын');
  assert.equal(refreshes, 1);
  assert.equal(requests, 2);
});
test('early EOF in a study stream does not become a successful generation', async () => {
  await assert.rejects(client(async () => sse(event({ type: 'progress', completed: 5, total: 10 }))).send('quiz', { count: 10 }), /толық аяқталмады/);
});
test('long text segmentation preserves every character, separators and Unicode', () => {
  const input = ('Бірінші абзац. Қазақ тілі — әдемі тіл. 😀 '.repeat(100) + '\n\n' + 'Екінші абзац. '.repeat(300)).trim();
  const parts = splitToolText(input);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.text.length <= 2400));
  assert.equal(parts.map((part) => part.text + part.separator).join(''), input);
});
const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
};
const material = (id, user_id = 'u1', updated_at = '2026-11-25T12:00:00Z') => ({ id, user_id, kind: 'quiz', title: id, content: { questions: [] }, updated_at });
test('local study cache keeps materials available during cloud failures and isolates accounts', () => {
  const backing = storage();
  const cache = createMaterialCache({ storage: backing });
  assert.equal(cache.put('u1', 'quiz', material('1')), true);
  assert.equal(createMaterialCache({ storage: backing }).list('u1', 'quiz')[0].id, '1');
  assert.deepEqual(cache.list('u2', 'quiz'), []);
  cache.merge('u2', 'quiz', [material('1')]);
  assert.deepEqual(cache.list('u2', 'quiz'), []);
});
test('cloud refresh does not erase a newly saved local result or duplicate a cloud copy', () => {
  const cache = createMaterialCache({ storage: storage() });
  cache.put('u1', 'quiz', material('new'));
  assert.equal(cache.merge('u1', 'quiz', []).rows.length, 1);
  assert.equal(cache.merge('u1', 'quiz', [material('new')]).rows.length, 1);
  cache.merge('u1', 'quiz', [{ ...material('new', 'u1', '2026-11-24T12:00:00Z'), title: 'stale' }]);
  assert.equal(cache.list('u1', 'quiz')[0].title, 'new');
});
test('unavailable local storage is reported without throwing away generated material', () => {
  const cache = createMaterialCache({ storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } } });
  assert.deepEqual(cache.list('u1', 'quiz'), []);
  assert.equal(cache.put('u1', 'quiz', material('1')), false);
});
test('the saving timeout includes SDK work before fetch begins', async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), { timeoutMs: 20 }), { name: 'TimeoutError' });
});
