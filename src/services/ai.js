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
  try {
    const retryAt = Number(
      safeStorage.getItem("sh-rate-limit:" + operation.userId) || 0,
    );
    if (retryAt > Date.now())
      throw Object.assign(
        new Error(
          "Лимит: " +
            new Date(retryAt).toLocaleTimeString() +
            " кейін қайталаңыз",
        ),
        { retryAfter: Math.ceil((retryAt - Date.now()) / 1000) },
      );
    const result = await client.send(task, payload, guarded, {
      ...options,
      signal: operation.signal,
    });
    operation.assert();
    if (task !== "chat") safeStorage.removeItem(key);
    document.dispatchEvent(
      new CustomEvent("smart-helper:quota", { detail: result }),
    );
    return result;
  } catch (error) {
    if (operation.valid() && error.retryAfter > 0) {
      const until = Date.now() + error.retryAfter * 1000;
      safeStorage.setItem("sh-rate-limit:" + operation.userId, String(until));
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
