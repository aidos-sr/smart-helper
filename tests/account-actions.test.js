import test from "node:test";
import assert from "node:assert/strict";
import { createAccountActions } from "../lib/account-actions.js";
import { captureSession, setSessionOwner } from "../lib/session-scope.js";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const session = (id) => ({ user: { id }, access_token: "test-token-" + id });
const config = () => ({
  supabaseUrl: "https://test.supabase.co",
  supabasePublishableKey: "test-publishable",
});

test("an account confirmation from A cannot delete or export the later B session", async () => {
  setSessionOwner(A);
  const confirmed = captureSession();
  setSessionOwner(B);
  let calls = 0;
  const actions = createAccountActions({
    getSession: () => session(B),
    getAuthConfig: config,
    fetchImpl: () => {
      calls++;
      throw new Error("must not run");
    },
  });
  await assert.rejects(actions.requestAccount("delete", confirmed), {
    name: "AbortError",
  });
  await assert.rejects(actions.requestAccount("export", confirmed), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
  setSessionOwner(null);
});
test("session changes before the queued request abort deletion before any HTTP call", async () => {
  setSessionOwner(A);
  const confirmed = captureSession();
  let calls = 0;
  const actions = createAccountActions({
    getSession: () => session(A),
    getAuthConfig: config,
    fetchImpl: () => {
      calls++;
      return Promise.resolve(Response.json({ deleted: true }));
    },
  });
  const pending = actions.requestAccount("delete", confirmed);
  setSessionOwner(B);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 0);
  setSessionOwner(null);
});
test("the token and expected owner remain A even when the SDK session changes during the request", async () => {
  setSessionOwner(A);
  let current = session(A),
    request,
    finish;
  const actions = createAccountActions({
    getSession: () => current,
    getAuthConfig: config,
    fetchImpl: async (url, init) => {
      request = { url, ...init };
      return new Promise((resolve) => (finish = resolve));
    },
  });
  const pending = actions.requestAccount("delete", captureSession());
  await new Promise((resolve) => setImmediate(resolve));
  current = session(B);
  setSessionOwner(B);
  finish(Response.json({ deleted: true }));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(request.headers.Authorization, "Bearer test-token-" + A);
  assert.equal(JSON.parse(request.body).expectedUserId, A);
  assert.equal(request.signal.aborted, true);
  setSessionOwner(null);
});
test("password recovery cannot mutate the next user, including logout and return to the same account", async () => {
  setSessionOwner(A);
  const recovery = captureSession();
  setSessionOwner(null);
  setSessionOwner(A);
  let calls = 0;
  const actions = createAccountActions({
    getSession: () => session(A),
    getAuthConfig: config,
    fetchImpl: () => {
      calls++;
      throw Error();
    },
  });
  await assert.rejects(actions.updatePassword("synthetic-password", recovery), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
  setSessionOwner(null);
});
test("a current password confirmation sends the captured credential directly to the configured auth endpoint", async () => {
  setSessionOwner(A);
  let request;
  const actions = createAccountActions({
    getSession: () => session(A),
    getAuthConfig: config,
    fetchImpl: async (url, init) => {
      request = { url, ...init };
      return Response.json({ id: A });
    },
  });
  await actions.updatePassword("synthetic-password", captureSession());
  assert.equal(request.url, "https://test.supabase.co/auth/v1/user");
  assert.equal(request.method, "PUT");
  assert.equal(request.headers.Authorization, "Bearer test-token-" + A);
  setSessionOwner(null);
});

test("OAuth and recovery callback credentials are detected before route rewriting", async () => {
  const { hasAuthCallback } = await import("../lib/auth-callback.js");
  assert.equal(
    hasAuthCallback({
      hash: "#access_token=synthetic&refresh_token=synthetic&type=recovery",
    }),
    true,
  );
  assert.equal(hasAuthCallback({ search: "?code=synthetic-pkce-code" }), true);
  assert.equal(hasAuthCallback({ hash: "#quiz" }), false);
  assert.equal(
    hasAuthCallback({ hash: "#auth", search: "?topic=logic" }),
    false,
  );
});
