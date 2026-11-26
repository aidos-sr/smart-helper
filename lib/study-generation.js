import { outlineRequest, validateOutline } from "./plan-outline.js";
import { similarQuestion } from "./content-quality.js";
import { generateUtility } from "./utility-provider.js";
import {
  parseStructuredContent,
  normalizeStructuredResult,
} from "./structured-results.js";
import { withDeadline } from "./deadline.js";

const bounded = (value, min, max, fallback) =>
  Math.min(max, Math.max(min, Number.parseInt(value, 10) || fallback));

// Preserve separators so long translations/corrections keep their paragraph layout.
export function splitToolText(input, maxChars = 2400) {
  const parts = [];
  let rest = String(input).trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = window.lastIndexOf("\n\n");
    if (cut < maxChars / 2) cut = window.lastIndexOf("\n");
    if (cut < maxChars / 2) {
      const sentences = [...window.matchAll(/[.!?。][ \t]+/g)];
      cut = sentences.at(-1)?.index + 1 || 0;
    }
    if (cut < maxChars / 2) cut = window.lastIndexOf(" ");
    if (cut < maxChars / 2) cut = maxChars;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    const tail = rest.slice(cut);
    const separator = tail.match(/^\s*/u)?.[0] || "";
    parts.push({ text: rest.slice(0, cut), separator });
    rest = tail.slice(separator.length);
  }
  if (rest) parts.push({ text: rest, separator: "" });
  return parts;
}

export function remainingStudyCalls(task, body, parts = [], useOutline = true) {
  const complete = new Set(
    parts.filter((part) => part.index >= 0).map((part) => part.index),
  );
  if (!["planner", "quiz", "flashcards"].includes(task)) {
    const chunks = task === "sum" ? [body.input] : splitToolText(body.input);
    return Math.max(
      1,
      chunks.filter((_, index) => !complete.has(index)).length,
    );
  }
  const total =
    task === "planner"
      ? bounded(body.days, 1, 30, 7)
      : task === "quiz"
        ? bounded(body.count, 3, 15, 5)
        : 6;
  const batches = task === "flashcards" ? 1 : Math.ceil(total / 5);
  const outline =
    task === "planner" &&
    total > 5 &&
    useOutline &&
    !parts.some((part) => part.index === -1)
      ? 1
      : 0;
  return Math.max(1, batches - complete.size + outline);
}

export async function generateStudyTask({
  task,
  body,
  buildRequest,
  models,
  request,
  onProgress = () => {},
  signal,
  deadline,
  onAttempt = () => {},
  resumeParts = [],
  useOutline = false,
  onCheckpoint = async () => {},
  cooldowns = new Map(),
}) {
  return withDeadline(
    async (jobSignal) => {
      const structured = ["planner", "quiz", "flashcards"].includes(task);
      const total =
        task === "planner"
          ? bounded(body.days, 1, 30, 7)
          : task === "quiz"
            ? bounded(body.count, 3, 15, 5)
            : task === "flashcards"
              ? 6
              : 1;
      const unit =
        { planner: "days", quiz: "questions", flashcards: "cards" }[task] ||
        "parts";
      let completed = 0;

      const emit = (stage = "generating") =>
        onProgress({ type: "progress", stage, completed, total, unit });
      const recordAttempt = (event) => {
        onAttempt(event);
        if (event.outcome === "timeout") emit("retrying");
      };
      emit();
      if (!structured) {
        const chunks =
          task === "sum"
            ? [{ text: body.input, separator: "" }]
            : splitToolText(body.input);
        const results = new Array(chunks.length);
        const modelsByPart = new Map();
        for (const part of resumeParts) {
          if (
            Number.isInteger(part.index) &&
            part.index >= 0 &&
            part.index < chunks.length &&
            typeof part.data?.text === "string" &&
            part.data.text.trim()
          ) {
            results[part.index] = part.data.text;
            modelsByPart.set(part.index, part.model);
            completed++;
          }
        }
        let next = 0;
        const worker = async () => {
          while (next < chunks.length) {
            const index = next++;
            if (results[index] !== undefined) continue;
            const result = await generateUtility({
              modelRequest: buildRequest({
                ...body,
                input: chunks[index].text,
                contextBefore: chunks[index - 1]?.text.slice(-300) || "",
                contextAfter: chunks[index + 1]?.text.slice(0, 300) || "",
                glossary: (
                  body.input.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []
                ).slice(0, 30),
              }),
              models,
              request,
              signal: jobSignal,
              deadline,
              cooldowns,
              onAttempt: recordAttempt,
              validate: (text) => ({ text: text.trim() }),
            });
            results[index] = result.text;
            modelsByPart.set(index, result.model);
            await onCheckpoint(
              results
                .map((text, index) =>
                  text === undefined
                    ? null
                    : { index, data: { text }, model: modelsByPart.get(index) },
                )
                .filter(Boolean),
            );
            completed++;
            onProgress({
              type: "progress",
              stage: "generating",
              completed,
              total: chunks.length,
              unit: "parts",
            });
          }
        };
        await Promise.all([worker(), worker()]);
        return {
          ok: true,
          text: results
            .map((text, index) => text + chunks[index].separator)
            .join(""),
        };
      }

      let preparedBody = body,
        outlinePart = resumeParts.find((part) => part.index === -1);
      if (task === "planner" && useOutline && total > 5) {
        if (!outlinePart) {
          const result = await generateUtility({
            modelRequest: outlineRequest(body),
            models,
            request,
            signal: jobSignal,
            deadline: Math.min(deadline, Date.now() + 35000),
            cooldowns,
            onAttempt: recordAttempt,
            validate: (content) => ({
              data: validateOutline(parseStructuredContent(content), body),
            }),
          });
          outlinePart = { index: -1, data: result.data, model: result.model };
          await onCheckpoint([outlinePart]);
        }
        const specification = validateOutline(outlinePart.data, body);
        preparedBody = {
          ...body,
          topic: specification.summary,
          planOutline: specification.outline,
        };
      }
      const batches = Array.from(
        { length: Math.ceil(total / 5) },
        (_, index) => ({
          start: index * 5 + 1,
          size: Math.min(5, total - index * 5),
          total,
        }),
      );
      if (task === "flashcards")
        batches.splice(0, batches.length, { start: 1, size: 6, total: 6 });
      const results = new Array(batches.length);
      for (const part of resumeParts) {
        if (
          Number.isInteger(part.index) &&
          part.index >= 0 &&
          part.index < batches.length
        ) {
          results[part.index] = part.data;
          completed += batches[part.index].size;
        }
      }
      for (const part of resumeParts) {
        if (part.index >= 0 && results[part.index])
          onProgress({
            type: "partial",
            index: part.index,
            start: batches[part.index].start,
            data: part.data,
            completed,
            total,
            unit,
            model: part.model,
          });
      }
      const successfulModels = new Set(
        resumeParts.map((part) => part.model).filter(Boolean),
      );
      const generatedQuestions = results
        .filter(Boolean)
        .flatMap((part) => part.questions?.map((q) => q.q) || []);
      let next = 0;
      const worker = async () => {
        while (next < batches.length) {
          const index = next++;
          const batch = batches[index];
          if (results[index]) continue;
          const remainingBatches = results.filter(Boolean).length;
          const batchDeadline = Math.min(
            deadline,
            Date.now() +
              Math.max(
                8000,
                (deadline - Date.now()) /
                  Math.max(
                    1,
                    Math.ceil(
                      (batches.length - remainingBatches) /
                        (task === "planner" ? 2 : 1),
                    ),
                  ),
              ),
          );
          const batchBody = {
            ...preparedBody,
            planOutline:
              preparedBody.planOutline ||
              Array.from({ length: total }, (_, i) => ({
                day: i + 1,
                phase:
                  i < total / 3
                    ? "foundations"
                    : i < (2 * total) / 3
                      ? "practice"
                      : "review",
                prerequisite: i || null,
              })),
            ...(task === "planner"
              ? { days: batch.size }
              : task === "quiz"
                ? { count: batch.size }
                : {}),
          };
          const result = await generateUtility({
            modelRequest: buildRequest(batchBody, {
              ...batch,
              avoid: generatedQuestions.map((q) => q.toLocaleLowerCase()),
            }),
            models,
            request,
            signal: jobSignal,
            deadline: batchDeadline,
            cooldowns,
            onAttempt: recordAttempt,
            validate: (content) => {
              let parsed = parseStructuredContent(content);
              if (
                task === "planner" &&
                batch.start > 1 &&
                Array.isArray(parsed?.days) &&
                parsed.days.every((day, i) => day?.day === batch.start + i)
              ) {
                parsed = {
                  days: parsed.days.map((day) => ({
                    ...day,
                    day: day.day - batch.start + 1,
                  })),
                };
              }
              const data = normalizeStructuredResult(task, parsed, batchBody, {
                batch: true,
              });
              if (
                task === "quiz" &&
                data.questions.some((question) =>
                  generatedQuestions.some((previous) =>
                    similarQuestion(previous, question.q),
                  ),
                )
              ) {
                throw new Error("DUPLICATE_QUESTION");
              }
              return { data };
            },
          });
          successfulModels.add(result.model);
          results[index] = result.data;
          if (task === "quiz")
            generatedQuestions.push(
              ...result.data.questions.map((question) => question.q),
            );
          completed += batch.size;
          await onCheckpoint([
            ...(outlinePart ? [outlinePart] : []),
            ...results
              .map((data, index) =>
                data ? { index, data, model: result.model } : null,
              )
              .filter(Boolean),
          ]);
          onProgress({
            type: "partial",
            data: result.data,
            index,
            start: batch.start,
            completed,
            total,
            unit,
            model: result.model,
          });
          emit();
        }
      };
      // Quiz batches are sequential so each sees all prior questions and avoids repeats.
      // Plan ranges are independent and can generate two at a time within one quota.
      if (task === "planner") await Promise.all([worker(), worker()]);
      else await worker();
      const key = { planner: "days", quiz: "questions", flashcards: "cards" }[
        task
      ];
      const combined = {
        [key]: results.flatMap((result, index) =>
          result[key].map((item, i) =>
            task === "planner"
              ? { ...item, day: batches[index].start + i }
              : item,
          ),
        ),
      };
      return {
        ok: true,
        data: normalizeStructuredResult(task, combined, body),
        provenance: {
          formatVersion: 2,
          promptVersion: "2026-11-25.2",
          models: [...successfulModels],
          verification: "teacher_review",
        },
      };
    },
    { signal, timeoutMs: Math.max(1, deadline - Date.now()) },
  );
}
