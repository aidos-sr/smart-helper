import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStructuredResult } from "../lib/structured-results.js";
import { arithmeticValue, similarQuestion } from "../lib/content-quality.js";
import { safeStorage } from "../lib/safe-storage.js";
import { createMaterialCache } from "../lib/material-cache.js";
import { setSessionOwner, sessionOperation } from "../lib/session-scope.js";
import { validateAttachments } from "../lib/attachment-validation.js";
import { PDFDocument } from "pdf-lib";
const q = (i = 0) => ({
  q: `Сұрақ ${i}?`,
  opts: ["1", "2", "3", "4"],
  correct: 0,
  explanation: "Бірінші нұсқа дұрыс.",
});
test("untrusted arithmetic keys are independently checked without eval", () => {
  assert.equal(arithmeticValue("2*(3+4)"), 14);
  assert.throws(() => arithmeticValue("process.exit()"));
  assert.throws(() =>
    normalizeStructuredResult(
      "quiz",
      {
        questions: [
          { ...q(), q: "2+2=?", opts: ["5", "4", "3", "2"] },
          q(1),
          q(2),
        ],
      },
      { count: 3 },
    ),
  );
  const result = normalizeStructuredResult(
    "quiz",
    {
      questions: [
        { ...q(), q: "2+2=?", opts: ["4", "5", "3", "2"] },
        q(1),
        q(2),
      ],
    },
    { count: 3 },
  );
  assert.equal(result.questions[0].verification, "computed");
});
test("structured field lengths and exact source quotes are enforced on both sides", () => {
  assert.throws(() =>
    normalizeStructuredResult(
      "quiz",
      { questions: [{ ...q(), q: "x".repeat(181) }, q(1), q(2)] },
      { count: 3 },
    ),
  );
  assert.throws(() =>
    normalizeStructuredResult(
      "quiz",
      { questions: [q(0), q(1), q(2)] },
      { count: 3, sourceText: "Сегіз таңбадан ұзын нақты мәтін." },
    ),
  );
  const questions = [0, 1, 2].map((i) => ({
    ...q(i),
    evidence: "нақты мәтін",
  }));
  assert.equal(
    normalizeStructuredResult(
      "quiz",
      { questions },
      { count: 3, sourceText: "Бұл — нақты мәтін." },
    ).questions[0].verification,
    "source_quote",
  );
  assert.equal(
    similarQuestion(
      "Ақиқат  кестесі қалай құрылады?",
      "Ақиқат кестесі қалай құрылады!",
    ),
    true,
  );
});
test("storage exceptions keep the latest value in memory and report that persistence failed", () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw Error("blocked");
    },
  });
  try {
    assert.equal(safeStorage.setItem("test", "new"), false);
    assert.equal(safeStorage.getItem("test"), "new");
    safeStorage.removeItem("test");
    assert.equal(safeStorage.getItem("test"), null);
  } finally {
    if (old) Object.defineProperty(globalThis, "localStorage", old);
    else delete globalThis.localStorage;
  }
});
test("31st pending material cannot evict the only copy of the first", () => {
  const backing = new Map(),
    storage = {
      getItem: (key) => backing.get(key),
      setItem: (key, value) => backing.set(key, value),
    };
  const cache = createMaterialCache({ storage, limit: 30 });
  for (let i = 0; i < 35; i++)
    cache.put("A", "quiz", {
      id: String(i),
      user_id: "A",
      kind: "quiz",
      content: { questions: [] },
      sync: "pending",
      updated_at: new Date(i * 1000).toISOString(),
    });
  assert.equal(cache.list("A", "quiz").length, 35);
  assert.ok(cache.list("A", "quiz").some((row) => row.id === "0"));
});
test("session generations invalidate A → logout → A as well as A → B", () => {
  setSessionOwner("A");
  const pending = sessionOperation();
  setSessionOwner(null);
  setSessionOwner("A");
  assert.equal(pending.valid(), false);
  assert.equal(pending.signal.aborted, true);
  assert.throws(() => pending.assert(), { name: "AbortError" });
  pending.close();
  setSessionOwner(null);
});
test("file signatures, pixel budgets and PDF page limits are validated in a bounded worker", async () => {
  await assert.rejects(
    validateAttachments([
      {
        kind: "image",
        type: "image/png",
        dataUrl:
          "data:image/png;base64," +
          Buffer.from("not a png").toString("base64"),
      },
    ]),
  );
  const document = await PDFDocument.create();
  document.addPage();
  const bytes = await document.save();
  await validateAttachments([
    {
      kind: "pdf",
      type: "application/pdf",
      dataUrl:
        "data:application/pdf;base64," + Buffer.from(bytes).toString("base64"),
    },
  ]);
  const tooMany = await PDFDocument.create();
  for (let i = 0; i < 51; i++) tooMany.addPage();
  await assert.rejects(
    validateAttachments([
      {
        kind: "pdf",
        type: "application/pdf",
        dataUrl:
          "data:application/pdf;base64," +
          Buffer.from(await tooMany.save()).toString("base64"),
      },
    ]),
  );
});

test("chat pages preserve all UTF-8 content below database byte and row limits", async () => {
  const { paginateChatMessages } = await import("../lib/chat-pages.js");
  const content = "Қазақша😀".repeat(20000);
  const pages = paginateChatMessages([{ role: "assistant", content }]);
  assert.ok(pages.length > 1);
  assert.equal(
    pages
      .flat()
      .map((m) => m.content)
      .join(""),
    content,
  );
  assert.ok(
    pages.every(
      (page) =>
        new TextEncoder().encode(JSON.stringify(page)).length <= 80000 &&
        page.length <= 40,
    ),
  );
});
