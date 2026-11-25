export function parseStructuredContent(content) {
  const source = content.trim().replace(/^\uFEFF/, '');
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const first = source.indexOf('{'), last = source.lastIndexOf('}');
  for (const candidate of [source, fenced, first >= 0 && last > first ? source.slice(first, last + 1) : null]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch {}
  }
  throw new Error('INVALID_STRUCTURED_RESPONSE');
}

const text = (value) => typeof value === 'string' && Boolean(value.trim());
const bounded = (value, min, max, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const key = (value) => value.trim().normalize('NFKC').toLocaleLowerCase();
const unique = (values) => new Set(values.map(key)).size === values.length;
const invalid = () => { throw new Error('INVALID_STRUCTURED_RESPONSE'); };

export function normalizeStructuredResult(task, value, body, { batch = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (task === 'planner') {
    const days = bounded(body.days, 1, 30, 7);
    if (!Array.isArray(value.days) || value.days.length !== days) invalid();
    const sorted = [...value.days].sort((a, b) => (a?.day || 0) - (b?.day || 0));
    return { days: sorted.map((day, index) => {
      if (day?.day !== index + 1 || !text(day.title) || !text(day.tasks) ||
          !['math', 'sci', 'hist', 'gen'].includes(day.subject)) invalid();
      return { day: day.day, title: day.title.trim(), tasks: day.tasks.trim(), subject: day.subject };
    }) };
  }
  if (task === 'flashcards') {
    if (!Array.isArray(value.cards) || value.cards.length !== 6 ||
        !value.cards.every((card) => text(card?.q) && text(card?.a)) ||
        !unique(value.cards.map((card) => card.q))) invalid();
    return { cards: value.cards.map((card) => ({ q: card.q.trim(), a: card.a.trim() })) };
  }
  if (task === 'quiz') {
    const count = bounded(body.count, batch ? 1 : 3, 15, 5);
    if (!Array.isArray(value.questions) || value.questions.length !== count) invalid();
    const questions = value.questions.map((question) => {
      if (!text(question?.q) || !Array.isArray(question.opts) || question.opts.length !== 4 ||
          !question.opts.every(text) || !unique(question.opts) ||
          !Number.isInteger(question.correct) || question.correct < 0 || question.correct > 3 ||
          !text(question.explanation)) invalid();
      return {
        q: question.q.trim(), opts: question.opts.map((option) => option.trim()),
        correct: question.correct, explanation: question.explanation.trim()
      };
    });
    if (!unique(questions.map((question) => question.q))) invalid();
    return { questions };
  }
  invalid();
}
