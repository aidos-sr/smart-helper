import { safeStorage, readJSON } from "../../lib/safe-storage.js";
import { sessionOperation } from "../../lib/session-scope.js";
import { createAIClient } from "../../lib/ai-http.js";
import {
  getCurrentSession,
  getCurrentUser,
  refreshCurrentSession,
} from "./supabase.js";
export { studyProgressText } from "../../lib/ai-http.js";

function requireAccess(options = {}) {
  const user = getCurrentUser();
  const session = getCurrentSession();
  if (!user || !session?.access_token) {
    if (options.onAuthRequired) options.onAuthRequired();
    else document.dispatchEvent(new CustomEvent("smart-helper:auth-required"));
    throw new Error("AI қолдану үшін жүйеге кіріңіз");
  }
  return session.access_token;
}

const client = createAIClient({
  getAccessToken: requireAccess,
  refreshSession: refreshCurrentSession,
});

async function scopedRequest(task, payload, handlers, options) {
  const operation = sessionOperation(options.signal);
  const key = `sh-job:${operation.userId}:${task}`,
    signature = JSON.stringify(payload),
    previous = readJSON(key, null);
  const operationId =
    options.operationId ||
    (previous?.signature === signature ? previous.id : crypto.randomUUID());
  if (task !== "chat")
    safeStorage.setItem(
      key,
      JSON.stringify({ id: operationId, signature, payload, task }),
    );
  options = { ...options, operationId };
  const guarded = Object.fromEntries(
    Object.entries(handlers)
      .filter(([, fn]) => typeof fn === "function")
      .map(([name, fn]) => [
        name,
        (...args) => {
          if (operation.valid()) fn(...args);
        },
      ]),
  );
  const limitKey = "sh-rate-limit:" + operation.userId;
  try {
    const cached = readJSON(limitKey, null);
    // Keep short waits from current server/provider responses, while retiring
    // old deadlines from deployments that enforced daily and minute usage caps.
    const retryAt =
      cached?.version === 3 &&
      Number.isFinite(cached.until) &&
      cached.until <= Date.now() + 60_000
        ? cached.until
        : 0;
    if (!retryAt || retryAt <= Date.now()) safeStorage.removeItem(limitKey);
    if (retryAt > Date.now())
      throw Object.assign(
        new Error(
          "Сұрау уақытша шектелді. Қайта тексеру: " +
            new Date(retryAt).toLocaleTimeString() +
            ".",
        ),
        {
          retryAfter: Math.ceil((retryAt - Date.now()) / 1000),
          localRateLimit: true,
        },
      );
    const result = await client.send(task, payload, guarded, {
      ...options,
      signal: operation.signal,
    });
    operation.assert();
    safeStorage.removeItem(limitKey);
    if (task !== "chat") safeStorage.removeItem(key);
    document.dispatchEvent(
      new CustomEvent("smart-helper:quota", { detail: result }),
    );
    return result;
  } catch (error) {
    const remaining = error.remaining || error.metadata?.remaining;
    if (operation.valid() && remaining)
      document.dispatchEvent(
        new CustomEvent("smart-helper:quota", { detail: { remaining } }),
      );
    if (
      operation.valid() &&
      !error.localRateLimit &&
      Number.isFinite(error.retryAfter) &&
      error.retryAfter > 0
    ) {
      const until = Date.now() + Math.min(60, error.retryAfter) * 1000;
      safeStorage.setItem(limitKey, JSON.stringify({ version: 3, until }));
      document.dispatchEvent(
        new CustomEvent("smart-helper:rate-limit", { detail: { until } }),
      );
    }
    throw error;
  } finally {
    operation.close();
  }
}
export function requestAI(task, payload = {}, options = {}) {
  return scopedRequest(
    task,
    payload,
    {
      onProgress: options.onProgress,
      onPartial: options.onPartial,
      onMeta: options.onMeta,
    },
    options,
  );
}
export function requestAIStream(payload = {}, handlers = {}, options = {}) {
  return scopedRequest("chat", payload, handlers, options);
}
