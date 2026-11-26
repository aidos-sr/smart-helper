import {
  questionKey,
  similarQuestion,
  verifyQuestion,
} from "./content-quality.js";
export function parseStructuredContent(content) {
  const source = content.trim().replace(/^\uFEFF/, "");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const first = source.indexOf("{"),
    last = source.lastIndexOf("}");
  for (const candidate of [
    source,
    fenced,
    first >= 0 && last > first ? source.slice(first, last + 1) : null,
  ]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  throw new Error("INVALID_STRUCTURED_RESPONSE");
}

const text = (value, max = 1000) =>
  typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const bounded = (value, min, max, fallback) => {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
};
const key = questionKey;
const unique = (values) => new Set(values.map(key)).size === values.length;
const invalid = () => {
  throw new Error("INVALID_STRUCTURED_RESPONSE");
};

export function normalizeStructuredResult(
  task,
  value,
  body,
  { batch = false } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  if (task === "planner") {
    const days = bounded(body.days, 1, 30, 7);
    if (!Array.isArray(value.days) || value.days.length !== days) invalid();
    const sorted = [...value.days].sort(
      (a, b) => (a?.day || 0) - (b?.day || 0),
    );
    return {
      days: sorted.map((day, index) => {
        if (
          day?.day !== index + 1 ||
          !text(day.title, 80) ||
          !text(day.tasks, 240) ||
          !["math", "sci", "hist", "gen"].includes(day.subject)
        )
          invalid();
        return {
          day: day.day,
          title: day.title.trim(),
          tasks: day.tasks.trim(),
          subject: day.subject,
        };
      }),
    };
  }
  if (task === "flashcards") {
    if (
      !Array.isArray(value.cards) ||
      value.cards.length !== 6 ||
      !value.cards.every((card) => text(card?.q, 160) && text(card?.a, 240)) ||
      !unique(value.cards.map((card) => card.q))
    )
      invalid();
    return {
      cards: value.cards.map((card) => {
        if (
          body.sourceText &&
          (!text(card.evidence, 1000) ||
            card.evidence.trim().length < 8 ||
            !body.sourceText
              .normalize("NFKC")
              .includes(card.evidence.trim().normalize("NFKC")))
        )
          invalid();
        return {
          q: card.q.trim(),
          a: card.a.trim(),
          ...(card.evidence ? { evidence: card.evidence.trim() } : {}),
          verification: body.sourceText ? "source_quote" : "teacher_review",
        };
      }),
    };
  }
  if (task === "quiz") {
    const count = bounded(body.count, batch ? 1 : 3, 15, 5);
    if (!Array.isArray(value.questions) || value.questions.length !== count)
      invalid();
    const questions = value.questions.map((question) => {
      if (
        !text(question?.q, 180) ||
        !Array.isArray(question.opts) ||
        question.opts.length !== 4 ||
        !question.opts.every((option) => text(option, 100)) ||
        !unique(question.opts) ||
        !Number.isInteger(question.correct) ||
        question.correct < 0 ||
        question.correct > 3 ||
        !text(question.explanation, 240)
      )
        invalid();
      return {
        q: question.q.trim(),
        opts: question.opts.map((option) => option.trim()),
        correct: question.correct,
        explanation: question.explanation.trim(),
        ...(question.evidence ? { evidence: question.evidence.trim() } : {}),
        verification: verifyQuestion(question, body.sourceText),
      };
    });
    if (!unique(questions.map((question) => question.q))) invalid();
    if (
      questions.some((q, i) =>
        questions
          .slice(0, i)
          .some((previous) => similarQuestion(q.q, previous.q)),
      )
    )
      invalid();
    return { questions };
  }
  invalid();
}
