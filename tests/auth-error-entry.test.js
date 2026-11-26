import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
const dom = new JSDOM(
  await readFile(new URL("../index.html", import.meta.url), "utf8"),
  {
    url: "http://localhost/#error=access_denied&error_code=otp_expired&error_description=synthetic-private-detail",
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
    assert.equal(location.hash, "#auth");
    callbackObserved = true;
    return Response.json({
      supabaseUrl: "https://callback.supabase.co",
      supabasePublishableKey: "test-public-key",
    });
  }
  if (url.includes("/auth/v1/settings"))
    return Response.json({ external: { google: false, email: true } });
  if (url.includes("/auth/v1/user"))
    return Response.json({
      id: "11111111-1111-4111-8111-111111111111",
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
test("an expired confirmation or reset link opens a useful error without retaining callback details", async () => {
  await import("../src/main.js");
  const supabase = await import("../src/services/supabase.js");
  for (let i = 0; i < 30 && !supabase.getSupabaseClient(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(callbackObserved, true);
  assert.equal(
    document.getElementById("pg-auth").classList.contains("on"),
    true,
  );
  assert.match(
    document.getElementById("lErr").textContent,
    /Сілтеменің мерзімі/,
  );
  assert.equal(document.getElementById("recoveryForm").hidden, true);
  assert.equal(location.hash, "#auth");
  assert.doesNotMatch(document.body.textContent, /synthetic-private-detail/);
});
