import { consumeAIStream } from './ai-client-stream.js';
import { normalizeStructuredResult } from './structured-results.js';
import { withDeadline } from './deadline.js';

const structuredTasks = new Set(['planner', 'quiz', 'flashcards']);
const friendlyError = (error, signal) => {
  if (error.name === 'TimeoutError') return new Error('Сұрау уақыты аяқталды. Қайталап көріңіз.');
  if (error.name === 'AbortError' && !signal?.aborted) return new Error('Байланыс үзілді. Қайталап көріңіз.');
  if (error instanceof TypeError) return new Error('Серверге қосылу мүмкін болмады. Интернет байланысын тексеріңіз.');
  return error;
};

export function createAIClient({ getAccessToken, refreshSession, fetchImpl = (...args) => fetch(...args) }) {
  async function send(task, payload = {}, handlers = {}, options = {}) {
    const requireData = structuredTasks.has(task);
    try {
      return await withDeadline(async (signal) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const accessToken = getAccessToken(options);
          const response = await fetchImpl('/api/chat', {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ ...payload, task, stream: true })
          });
          if (response.status === 401 && attempt === 0) {
            await response.body?.cancel();
            await withDeadline(() => refreshSession(), { timeoutMs: 8000, signal });
            continue;
          }
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || (response.status === 429 ? 'Сұрау лимиті аяқталды. Біраздан кейін қайталап көріңіз.' : 'Қызмет уақытша қолжетімсіз. Қайталап көріңіз.'));
          }
          let result;
          if (response.headers.get('content-type')?.includes('text/event-stream')) {
            if (!response.body) throw new Error('Жауап алынбады');
            result = await consumeAIStream(response.body, handlers, { signal, requireData });
          } else {
            try { result = await response.json(); }
            catch { throw new Error('Серверден толық жауап алынбады. Қайталап көріңіз.'); }
          }
          if (requireData) {
            try { result.data = normalizeStructuredResult(task, result.data, payload); }
            catch { throw new Error('Материал толық алынбады. Қайталап көріңіз.'); }
          } else if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('AI жауабы бос болды');
          return result;
        }
      }, { timeoutMs: options.timeoutMs || (task === 'chat' ? 65_000 : 175_000), signal: options.signal });
    } catch (error) { throw friendlyError(error, options.signal); }
  }
  return { send };
}

export function studyProgressText(progress) {
  const unit = { days: 'күн', questions: 'сұрақ', cards: 'карточка', parts: 'бөлік' }[progress.unit] || 'бөлік';
  return progress.completed > 0
    ? `${progress.completed}/${progress.total} ${unit} дайын${progress.completed < progress.total ? ', жалғасуда...' : ''}`
    : 'AI материалды дайындауда...';
}
