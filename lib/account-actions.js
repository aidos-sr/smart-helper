import { captureSession, sessionOperation } from "./session-scope.js";
import { withDeadline } from "./deadline.js";

// A mutation uses the session the person confirmed. Never re-read credentials
// from an asynchronously refreshed SDK session after choosing its owner.
export function createAccountActions({
  getSession,
  getAuthConfig,
  fetchImpl = (...args) => fetch(...args),
}) {
  async function run(scope, buildRequest) {
    scope.assert();
    if (!scope.userId) throw new Error("Жүйеге қайта кіріңіз");
    const operation = sessionOperation();
    try {
      const session = getSession();
      if (session?.user?.id !== scope.userId || !session?.access_token)
        throw new DOMException("Session changed", "AbortError");
      const request = buildRequest(session);
      return await withDeadline(
        async (signal) => {
          scope.assert();
          operation.assert();
          const response = await fetchImpl(request.url, {
            ...request.init,
            signal,
          });
          const result = await response.json();
          scope.assert();
          operation.assert();
          if (!response.ok)
            throw new Error(result.error || result.msg || "Әрекет орындалмады");
          return result;
        },
        { timeoutMs: 15000, signal: operation.signal },
      );
    } finally {
      operation.close();
    }
  }
  return {
    requestAccount(action, scope = captureSession()) {
      if (!["export", "delete"].includes(action))
        throw new Error("Белгісіз әрекет");
      return run(scope, (session) => ({
        url: "/api/account",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action, expectedUserId: scope.userId }),
        },
      }));
    },
    updatePassword(password, scope) {
      if (!scope)
        return Promise.reject(
          new Error("Қалпына келтіру сілтемесін қайта ашыңыз"),
        );
      return run(scope, (session) => {
        const config = getAuthConfig();
        if (!config?.supabaseUrl || !config.supabasePublishableKey)
          throw new Error("Кіру қызметі дайын емес");
        return {
          url: config.supabaseUrl.replace(/\/$/, "") + "/auth/v1/user",
          init: {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              apikey: config.supabasePublishableKey,
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ password }),
          },
        };
      });
    },
  };
}
