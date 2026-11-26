import test from "node:test";
import assert from "node:assert/strict";
import { createAuthActions, authErrorMessage } from "../lib/auth-actions.js";
import { authCallbackError, hasAuthCallback } from "../lib/auth-callback.js";

function setup(options = {}) {
  const values = new Map(),
    calls = [];
  let time = 1000;
  const auth = Object.fromEntries(
    [
      "signUp",
      "resetPasswordForEmail",
      "resend",
      "signInWithPassword",
      "signInWithOAuth",
    ].map((name) => [
      name,
      async (payload) => {
        calls.push({ name, payload });
        return name === "signInWithOAuth"
          ? {
              data: {
                url: "https://auth.example.org/auth/v1/authorize?provider=google",
              },
              error: null,
            }
          : { data: { session: null }, error: null };
      },
    ]),
  );
  const config = {
    getClient: () => ({ auth }),
    initialize: async () => {},
    storage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
    projectKey: "test",
    origin: () => "https://app.example.org",
    now: () => time,
    ...options,
  };
  return {
    actions: createAuthActions(config),
    auth,
    calls,
    values,
    advance: (ms) => {
      time += ms;
    },
    config,
  };
}

test("signup, reset and resend share an in-flight guard without sending duplicate email", async () => {
  const s = setup();
  let finish;
  s.auth.signUp = async () => {
    s.calls.push({ name: "signUp" });
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = s.actions.register({
    email: "synthetic@example.org",
    password: "synthetic-password",
  });
  await Promise.resolve();
  await Promise.resolve();
  await assert.rejects(
    s.actions.resetPassword("synthetic@example.org"),
    (error) => error.code === "auth_busy",
  );
  await assert.rejects(
    s.actions.register({}),
    (error) => error.code === "auth_busy",
  );
  finish({ data: { session: null }, error: null });
  await pending;
  assert.equal(s.calls.length, 1);
});
test("successful mail persists a shared cooldown across page instances without storing email or password", async () => {
  const s = setup();
  await s.actions.register({
    email: "synthetic@example.org",
    password: "synthetic-password",
  });
  const reloaded = createAuthActions(s.config);
  await assert.rejects(
    reloaded.resendConfirmation("synthetic@example.org"),
    (error) => error.code === "email_cooldown",
  );
  await assert.rejects(
    reloaded.resetPassword("another@example.org"),
    (error) => error.code === "email_cooldown",
  );
  assert.equal(s.calls.length, 1);
  assert.doesNotMatch(
    JSON.stringify([...s.values]),
    /example.org|synthetic-password/,
  );
  s.advance(60001);
  await reloaded.resetPassword("synthetic@example.org");
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].payload, "synthetic@example.org");
});
test("backend mail rate limits preserve the server wait and do not retry automatically", async () => {
  const s = setup({ getMailRetryAfter: () => 125 });
  let attempts = 0;
  s.auth.resetPasswordForEmail = async () => {
    attempts++;
    return { error: { status: 429, code: "over_email_send_rate_limit" } };
  };
  await assert.rejects(s.actions.resetPassword("synthetic@example.org"));
  assert.equal(s.actions.mailState().seconds, 125);
  await assert.rejects(
    s.actions.register({}),
    (error) => error.code === "email_cooldown",
  );
  assert.equal(attempts, 1);
});
test("uncertain delivery is bounded and asks to check the inbox before a new send", async () => {
  const s = setup({ requestTimeoutMs: 10 });
  s.auth.resetPasswordForEmail = () => new Promise(() => {});
  await assert.rejects(
    s.actions.resetPassword("synthetic@example.org"),
    (error) => error.code === "mail_delivery_unknown",
  );
  assert.equal(s.actions.mailState().seconds, 60);
  await assert.rejects(
    s.actions.resendConfirmation("synthetic@example.org"),
    (error) => error.code === "email_cooldown",
  );
});
test("invalid input errors release the form without imposing a mail cooldown", async () => {
  const s = setup();
  s.auth.signUp = async () => ({
    error: { status: 422, code: "validation_failed" },
  });
  await assert.rejects(s.actions.register({}));
  assert.equal(s.actions.mailState().busy, false);
  assert.equal(s.actions.mailState().seconds, 0);
});
test("confirmation and recovery use explicit application redirect targets", async () => {
  const s = setup();
  await s.actions.register({
    email: "synthetic@example.org",
    options: { data: { display_name: "Test" } },
  });
  assert.equal(
    s.calls[0].payload.options.emailRedirectTo,
    "https://app.example.org/",
  );
  assert.equal(s.calls[0].payload.options.data.display_name, "Test");
  s.advance(60001);
  let redirect;
  s.auth.resetPasswordForEmail = async (_email, options) => {
    redirect = options.redirectTo;
    return { data: {}, error: null };
  };
  await s.actions.resetPassword("synthetic@example.org");
  assert.equal(redirect, "https://app.example.org/");
});
test("a disabled Google provider is detected before attempting an OAuth redirect", async () => {
  const s = setup({ getAvailability: async () => ({ google: false }) });
  await assert.rejects(
    s.actions.google(),
    (error) => error.code === "provider_disabled",
  );
  assert.equal(s.calls.length, 0);
});
test("enabled Google login requests one redirect, with an explicit return URL", async () => {
  let target;
  const s = setup({
    getAvailability: async () => ({ google: true }),
    getAuthOrigin: () => "https://auth.example.org",
    navigate: (url) => {
      target = url;
    },
  });
  await s.actions.google();
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].payload.options.skipBrowserRedirect, true);
  assert.equal(
    s.calls[0].payload.options.redirectTo,
    "https://app.example.org/",
  );
  assert.equal(
    target,
    "https://auth.example.org/auth/v1/authorize?provider=google",
  );
});
test("OAuth never redirects to an unexpected host or an executable URL", async () => {
  for (const url of ["javascript:alert(1)", "https://other.example.org/auth"]) {
    let navigated = false;
    const s = setup({
      getAuthOrigin: () => "https://auth.example.org",
      navigate: () => {
        navigated = true;
      },
    });
    s.auth.signInWithOAuth = async () => ({ data: { url }, error: null });
    await assert.rejects(
      s.actions.google(),
      (error) => error.code === "access_denied",
    );
    assert.equal(navigated, false);
  }
});
test("callback errors are recognized without consuming or displaying callback credentials", () => {
  const location = {
    hash: "#error=access_denied&error_code=otp_expired&error_description=private-detail",
    search: "",
  };
  assert.equal(hasAuthCallback(location), true);
  assert.deepEqual(authCallbackError(location), { code: "otp_expired" });
  assert.match(location.hash, /private-detail/);
  assert.equal(
    authCallbackError({
      hash: "#access_token=synthetic&refresh_token=synthetic",
    }),
    null,
  );
  assert.doesNotMatch(
    authErrorMessage({ message: "smtp_pass=private-detail" }),
    /private-detail/,
  );
});
