import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const A = "11111111-1111-4111-8111-111111111111";
const token =
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ) +
  "." +
  Buffer.from(
    JSON.stringify({
      sub: A,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      aud: "authenticated",
      role: "authenticated",
    }),
  ).toString("base64url") +
  ".test-signature";
const dom = new JSDOM(
  await readFile(new URL("../index.html", import.meta.url), "utf8"),
  {
    url: `http://localhost/#access_token=${token}&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=recovery`,
    pretendToBeVisual: true,
  },
);
globalThis.BroadcastChannel = undefined;
for (const key of [
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
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
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
const originalFetch = globalThis.fetch;
let callbackObserved = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === "/api/config") {
    assert.match(location.hash, /access_token=/);
    callbackObserved = true;
    return Response.json({
      supabaseUrl: "https://callback.supabase.co",
      supabasePublishableKey: "test-public-key",
    });
  }
  if (url.includes("/auth/v1/user"))
    return Response.json({
      id: A,
      email: "test@example.com",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
    });
  if (url.includes("/rpc/merge_progress_events"))
    return Response.json({ stats: {}, xp: 0 });
  if (url.includes("/rest/v1/")) return Response.json([]);
  throw new Error("Unexpected test request " + url);
};
after(async () => {
  (await import("../lib/session-scope.js")).setSessionOwner(null);
  (await import("../src/services/supabase.js"))
    .getSupabaseClient()
    ?.auth.stopAutoRefresh();
  dom.window.close();
});
test("a recovery callback survives app startup and opens the password form for its original owner", async () => {
  await import("../src/main.js");
  const supabase = await import("../src/services/supabase.js");
  for (
    let i = 0;
    i < 100 && document.getElementById("recoveryForm").hidden;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(callbackObserved, true);
  assert.equal(supabase.getCurrentUser()?.id, A);
  assert.equal(document.getElementById("recoveryForm").hidden, false);
  assert.equal(
    document.getElementById("pg-auth").classList.contains("on"),
    true,
  );
  assert.doesNotMatch(location.hash, /access_token=/);
});
