import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM(
  await readFile(new URL("../index.html", import.meta.url), "utf8"),
  { url: "http://localhost/", pretendToBeVisual: true },
);
const { window } = dom;
globalThis.BroadcastChannel = undefined;
for (const name of [
  "window",
  "document",
  "location",
  "history",
  "localStorage",
  "CustomEvent",
  "MutationObserver",
  "Option",
  "FileReader",
  "Image",
])
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: window[name],
  });
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: window.navigator,
});
globalThis.innerHeight = 800;
window.scrollTo = () => {};
globalThis.matchMedia = window.matchMedia = () => ({
  matches: true,
  addEventListener() {},
});
globalThis.requestAnimationFrame = (fn) => {
  queueMicrotask(() => fn(100));
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
window.HTMLCanvasElement.prototype.getContext = () => ({
  clearRect() {},
  beginPath() {},
  arc() {},
  fill() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  createRadialGradient: () => ({ addColorStop() {} }),
});
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
let currentId = A,
  aiReply,
  historyReply,
  progressReply,
  cloudOffline = false,
  upserts = [],
  rpcCalls = [];
const encode = (data) => "data: " + JSON.stringify(data) + "\n\n";
const json = (data) => Response.json(data);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === "/api/config")
    return json({
      supabaseUrl: "https://test.supabase.co",
      supabasePublishableKey: "fake-publishable-key",
    });
  if (url.includes("/auth/v1/user"))
    return json({
      id: currentId,
      email: currentId + "@example.com",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
    });
  if (url.includes("/auth/v1/logout"))
    return new Response(null, { status: 204 });
  if (url.includes("/rpc/merge_progress_events")) {
    const payload = JSON.parse(init.body);
    rpcCalls.push(payload);
    return progressReply
      ? progressReply()
      : json({
          xp:
            payload.p_baseline.xp +
            payload.p_events.reduce((sum, e) => sum + (e.xp || 0), 0),
          stats: payload.p_baseline.stats,
        });
  }
  if (url.includes("/rest/v1/chats")) {
    if (init.method === "POST") {
      upserts.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    }
    return historyReply ? historyReply(url) : json([]);
  }
  if (url.includes("/rest/v1/study_materials")) {
    if (init.method === "POST") {
      if (cloudOffline) throw new Error("offline");
      upserts.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    }
    return json([]);
  }
  if (url === "/api/chat")
    return aiReply ? aiReply(init) : json({ text: "Дайын" });
  throw new Error("Unexpected test request " + url);
};
await import("../src/main.js");
const supa = await import("../src/services/supabase.js");
assert.equal(supa.getSupabaseClient(), null);
document.querySelector('[data-go="auth"]').click();
const scopeModule = await import("../lib/session-scope.js");
const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
for (let i = 0; i < 30 && !supa.getSupabaseClient(); i++) await delay();
async function switchUser(id) {
  currentId = id;
  const token =
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        role: "authenticated",
      }),
    ).toString("base64url") +
    ".test-signature";
  const { error } = await supa.getSupabaseClient().auth.setSession({
    access_token: token,
    refresh_token: "fake-refresh-" + id,
  });
  assert.ifError(error);
  await delay();
}
const question = (i) => ({
  q: `Сұрақ ${i}?`,
  opts: ["1", "2", "3", "4"],
  correct: 0,
  explanation: "Бірінші жауап дұрыс.",
});
after(async () => {
  scopeModule.setSessionOwner(null);
  supa.getSupabaseClient().auth.stopAutoRefresh();
  globalThis.fetch = originalFetch;
  dom.window.close();
});

test("whole app initializes semantic forms, keyboard card, labels and hidden study settings", async () => {
  assert.equal(document.querySelector("#fL").tagName, "FORM");
  assert.equal(document.querySelector("#lE").required, true);
  assert.equal(document.querySelector("#lE").labels[0].htmlFor, "lE");
  assert.equal(document.querySelector(".flashcard-scene").tabIndex, 0);
  assert.equal(document.querySelector(".study-options").hidden, true);
  assert.equal(
    document.querySelector("#burger").getAttribute("aria-expanded"),
    "false",
  );
});
test("late quiz from A cannot render or save under B", async () => {
  await switchUser(A);
  let resolve;
  aiReply = () => new Promise((r) => (resolve = r));
  const quiz = await import("../src/modules/quiz.js");
  document.querySelector("#quizTopic").value = "A private topic";
  const pending = quiz.genQuiz();
  await delay();
  await switchUser(B);
  resolve(
    json({
      data: { questions: Array.from({ length: 10 }, (_, i) => question(i)) },
    }),
  );
  await pending;
  await delay();
  assert.equal(document.querySelector("#quizTopic").value, "");
  assert.equal(document.querySelector("#quizQ").textContent, "");
  assert.ok(
    !upserts.some(
      (row) =>
        row.user_id === B && JSON.stringify(row).includes("A private topic"),
    ),
  );
});
test("late A history never appears in B UI", async () => {
  let resolve;
  historyReply = (url) =>
    url.includes(A) ? new Promise((r) => (resolve = r)) : json([]);
  await switchUser(A);
  for (let i = 0; i < 20 && !resolve; i++) await delay();
  await switchUser(B);
  resolve(
    json([
      {
        id: "old",
        title: "A secret history",
        updated_at: new Date().toISOString(),
      },
    ]),
  );
  await delay();
  await delay();
  assert.ok(
    !document.querySelector("#hlist").textContent.includes("A secret history"),
  );
  historyReply = null;
});
test("a slow cloud snapshot preserves XP earned during the read", async () => {
  await switchUser(A);
  const storage = (await import("../lib/safe-storage.js")).safeStorage;
  storage.setItem("sh-xp:" + A, "100");
  storage.removeItem("sh-progress-baseline:" + A);
  storage.removeItem("sh-progress-events:" + A);
  let resolve;
  progressReply = () => new Promise((r) => (resolve = r));
  const progress = await import("../src/modules/progress.js");
  const pending = progress.loadProgress();
  await delay();
  progress.addXP(5);
  resolve(json({ xp: 100, stats: {} }));
  await pending;
  assert.equal(storage.getItem("sh-xp:" + A), "105");
  progressReply = null;
});
test("offline materials remain pending and online flush sends stable IDs to their original owner", async () => {
  await switchUser(A);
  cloudOffline = true;
  const library = await import("../src/modules/library.js");
  const saved = await library.saveStudyMaterial(
    "quiz",
    "Offline",
    { questions: [question(1), question(2), question(3)] },
    A,
  );
  assert.equal(saved.storage, "local");
  cloudOffline = false;
  await library.flushMaterials();
  assert.ok(upserts.some((row) => row.id === saved.id && row.user_id === A));
});
test("saved invalid quiz is rejected without destroying the page", async () => {
  const { validateMaterial } = await import("../src/modules/library.js");
  assert.throws(() =>
    validateMaterial("quiz", { questions: [{ q: "x", opts: null }] }),
  );
  assert.ok(document.querySelector("#pg-quiz"));
});
test("rich text keeps dollars in code, escapes HTML and renders Markdown tables", async () => {
  const { renderRichText, hasMath } = await import("../src/utils/rich-text.js");
  const code = '```js\nconst price = "$5 and $6";\n```';
  const html = renderRichText(code);
  assert.match(html, /<pre><code>const price/);
  assert.match(html, /\$5 and \$6/);
  assert.doesNotMatch(html, /katex|math-raw|SHCODE/);
  assert.equal(hasMath(code), false);
  assert.match(
    renderRichText("| A | B |\n| --- | --- |\n| 1 | 2 |"),
    /<table>/,
  );
  assert.doesNotMatch(renderRichText("<img src=x onerror=alert(1)>"), /<img/);
  assert.doesNotMatch(renderRichText("[x](javascript:alert(1))"), /<a /);
});
test("first checked quiz block is usable before the final block arrives", async () => {
  await switchUser(A);
  let streamController;
  aiReply = () =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            streamController = c;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
  const quiz = await import("../src/modules/quiz.js");
  document.querySelector("#quizTopic").value = "Progressive";
  const pending = quiz.genQuiz();
  await delay();
  streamController.enqueue(
    new TextEncoder().encode(
      encode({
        type: "partial",
        index: 0,
        completed: 5,
        total: 10,
        data: { questions: Array.from({ length: 5 }, (_, i) => question(i)) },
      }),
    ),
  );
  await delay();
  await delay();
  assert.match(document.querySelector("#quizQ").textContent, /Сұрақ 0/);
  assert.equal(document.querySelectorAll(".quiz-opt").length, 4);
  streamController.enqueue(
    new TextEncoder().encode(
      encode({
        type: "done",
        data: { questions: Array.from({ length: 10 }, (_, i) => question(i)) },
      }),
    ),
  );
  await pending;
  assert.equal(document.querySelector("#quizActive").style.display, "block");
});

test('Retry-After prevents a second provider call and card XP requires viewing the answer',async()=>{
 await switchUser(A);const {safeStorage}=await import('../lib/safe-storage.js');safeStorage.removeItem('sh-rate-limit:'+A);let attempts=0;
 aiReply=()=>{attempts++;return Promise.resolve(Response.json({error:'Rate limited',requestId:'test-request'},{status:429,headers:{'retry-after':'1'}}));};
 const {requestAI}=await import('../src/services/ai.js');await assert.rejects(requestAI('fix',{input:'test'}));await assert.rejects(requestAI('fix',{input:'test'}));assert.equal(attempts,1);safeStorage.removeItem('sh-rate-limit:'+A);
 const cards=await import('../src/modules/flashcards.js');cards.initFlashcards();const before=Number(safeStorage.getItem('sh-xp:'+A)||0);cards.fcResult('good');assert.equal(Number(safeStorage.getItem('sh-xp:'+A)||0),before);cards.flipCard();cards.fcResult('good');cards.fcResult('good');assert.equal(Number(safeStorage.getItem('sh-xp:'+A)||0),before+5);
});
