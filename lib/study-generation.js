import { generateUtility } from './utility-provider.js';
import { parseStructuredContent, normalizeStructuredResult } from './structured-results.js';
import { withDeadline } from './deadline.js';

const bounded = (value, min, max, fallback) => Math.min(max, Math.max(min, Number.parseInt(value, 10) || fallback));

// Preserve separators so long translations/corrections keep their paragraph layout.
export function splitToolText(input, maxChars = 2400) {
  const parts = [];
  let rest = String(input).trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = window.lastIndexOf('\n\n');
    if (cut < maxChars / 2) cut = window.lastIndexOf('\n');
    if (cut < maxChars / 2) cut = window.lastIndexOf(' ');
    if (cut < maxChars / 2) cut = maxChars;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    const tail = rest.slice(cut);
    const separator = tail.match(/^\s*/u)?.[0] || '';
    parts.push({ text: rest.slice(0, cut), separator });
    rest = tail.slice(separator.length);
  }
  if (rest) parts.push({ text: rest, separator: '' });
  return parts;
}

export async function generateStudyTask({ task, body, buildRequest, models, request, onProgress = () => {}, signal, deadline, onAttempt = () => {} }) {
  return withDeadline(async (jobSignal) => {
    const structured = ['planner', 'quiz', 'flashcards'].includes(task);
    const total = task === 'planner' ? bounded(body.days, 1, 30, 7)
      : task === 'quiz' ? bounded(body.count, 3, 15, 5)
      : task === 'flashcards' ? 6 : 1;
    const unit = { planner: 'days', quiz: 'questions', flashcards: 'cards' }[task] || 'parts';
    let completed = 0;
    const cooldowns = new Map();
    const emit = (stage = 'generating') => onProgress({ type: 'progress', stage, completed, total, unit });
    const recordAttempt = (event) => {
      onAttempt(event);
      if (event.outcome === 'timeout') emit('retrying');
    };
    emit();
    if (!structured) {
      const chunks = task === 'sum' ? [{ text: body.input, separator: '' }] : splitToolText(body.input);
      const results = new Array(chunks.length);
      let next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const index = next++;
          const result = await generateUtility({
            modelRequest: buildRequest({ ...body, input: chunks[index].text }), models, request, signal: jobSignal, deadline, cooldowns, onAttempt: recordAttempt,
            validate: (text) => ({ text: text.trim() })
          });
          results[index] = result.text + chunks[index].separator;
          completed++;
          onProgress({ type: 'progress', stage: 'generating', completed, total: chunks.length, unit: 'parts' });
        }
      };
      await Promise.all([worker(), worker()]);
      return { ok: true, text: results.join('') };
    }

    const batches = Array.from({ length: Math.ceil(total / 5) }, (_, index) => ({ start: index * 5 + 1, size: Math.min(5, total - index * 5), total }));
    if (task === 'flashcards') batches.splice(0, batches.length, { start: 1, size: 6, total: 6 });
    const results = new Array(batches.length);
    const generatedQuestions = [];
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const index = next++;
        const batch = batches[index];
        const batchBody = { ...body, ...(task === 'planner' ? { days: batch.size } : task === 'quiz' ? { count: batch.size } : {}) };
        const result = await generateUtility({
          modelRequest: buildRequest(batchBody, { ...batch, avoid: generatedQuestions }), models, request, signal: jobSignal, deadline, cooldowns, onAttempt: recordAttempt,
          validate: (content) => {
            let parsed = parseStructuredContent(content);
            if (task === 'planner' && batch.start > 1 && Array.isArray(parsed?.days) && parsed.days.every((day, i) => day?.day === batch.start + i)) {
              parsed = { days: parsed.days.map((day) => ({ ...day, day: day.day - batch.start + 1 })) };
            }
            const data = normalizeStructuredResult(task, parsed, batchBody, { batch: true });
            if (task === 'quiz' && data.questions.some((question) => generatedQuestions.includes(question.q.trim().normalize('NFKC').toLocaleLowerCase()))) {
              throw new Error('DUPLICATE_QUESTION');
            }
            return { data };
          }
        });
        results[index] = result.data;
        if (task === 'quiz') generatedQuestions.push(...result.data.questions.map((question) => question.q.trim().normalize('NFKC').toLocaleLowerCase()));
        completed += batch.size;
        emit();
      }
    };
    // Quiz batches are sequential so each sees all prior questions and avoids repeats.
    // Plan ranges are independent and can generate two at a time within one quota.
    if (task === 'planner') await Promise.all([worker(), worker()]);
    else await worker();
    const key = { planner: 'days', quiz: 'questions', flashcards: 'cards' }[task];
    const combined = { [key]: results.flatMap((result, index) => result[key].map((item, i) => task === 'planner' ? { ...item, day: batches[index].start + i } : item)) };
    return { ok: true, data: normalizeStructuredResult(task, combined, body) };
  }, { signal, timeoutMs: Math.max(1, deadline - Date.now()) });
}
