import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL = "https://test-account.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-only-not-a-key";
const { default: handler } = await import("../api/account.js");
const originalFetch = globalThis.fetch,
  A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
let mutations;
beforeEach(() => {
  mutations = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: B });
    if (init.method === "DELETE") {
      mutations.push(url);
      return Response.json({ id: B });
    }
    throw new Error("Unexpected request " + url);
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const invoke = async (body) => {
  const response = {
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
  };
  await handler(
    {
      method: "POST",
      headers: { authorization: "Bearer test-session-B" },
      body,
    },
    response,
  );
  return response;
};
test("a B credential cannot apply a deletion confirmed for A", async () => {
  const response = await invoke({ action: "delete", expectedUserId: A });
  assert.equal(response.statusCode, 409);
  assert.equal(mutations.length, 0);
});
test("deletion requires an explicit expected owner", async () => {
  assert.equal((await invoke({ action: "delete" })).statusCode, 409);
  assert.equal(mutations.length, 0);
});
test("a matching owner can delete only their authenticated account", async () => {
  assert.equal(
    (await invoke({ action: "delete", expectedUserId: B })).statusCode,
    200,
  );
  assert.equal(mutations.length, 1);
  assert.ok(mutations[0].endsWith("/auth/v1/admin/users/" + B));
});
