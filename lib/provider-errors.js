import { withDeadline } from "./deadline.js";
import { cancelStream } from "./sse.js";

export const PROVIDER_ALL = "openrouter:all";
export const PROVIDER_FREE = "openrouter:free";
export const isFreeModel = (model) =>
  String(model).endsWith(":free") || model === "openrouter/free";

export function retrySeconds(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = /^\d+(\.\d+)?$/.test(String(value).trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds)
    ? Math.max(0, Math.min(86400, Math.ceil(seconds)))
    : 0;
}

export function providerError(
  data = {},
  status = 502,
  headers = new Headers(),
  now = Date.now(),
) {
  const detail = data.error || data;
  status =
    Number(detail.code) ||
    {
      rate_limit_exceeded: 429,
      insufficient_quota: 402,
      insufficient_credits: 402,
      invalid_api_key: 401,
      model_not_found: 404,
    }[detail.code] ||
    status;
  const message = String(detail.message || "");
  const metadata = detail.metadata || {};
  const hint = (name) =>
    Object.entries(metadata.headers || {}).find(
      ([key]) => key.toLowerCase() === name,
    )?.[1];
  const freeLimit = /free[-_ ]models[-_ ]per[-_ ](day|min)/i.test(message);
  const keyLimit = status === 429 && (freeLimit || !metadata.provider_name);
  const filtered =
    status === 403 && /moderation|content.policy|safety|flagged/i.test(message);
  const formatUnsupported =
    [400, 422].includes(status) ||
    (status === 404 &&
      /support.{0,80}(response.format|json|reasoning|parameters)|response.format.{0,40}(unsupported|not.support)/i.test(
        message,
      ));
  const stopRetries = status === 401 || status === 402 || keyLimit || filtered;
  const kind = filtered
    ? "filtered"
    : status === 429
      ? "busy"
      : status === 402
        ? "budget"
        : status === 401
          ? "configuration"
          : "unavailable";
  let retryAfter = retrySeconds(
    headers.get("retry-after") || hint("retry-after"),
    now,
  );
  const reset = Number(
    headers.get("x-ratelimit-reset") || hint("x-ratelimit-reset"),
  );
  if (!retryAfter && reset > 0)
    retryAfter = Math.max(
      1,
      Math.min(
        86400,
        Math.ceil(((reset > 1e12 ? reset : reset * 1000) - now) / 1000),
      ),
    );
  if (!retryAfter && /free[-_ ]models[-_ ]per[-_ ]day/i.test(message))
    retryAfter = Math.ceil(
      (Date.parse(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z") +
        86400000 -
        now) /
        1000,
    );
  if (!retryAfter && [401, 402, 429, 503].includes(status)) retryAfter = 60;
  return Object.assign(new Error(kind), {
    kind,
    status,
    stopRetries,
    retryAfter,
    formatUnsupported,
    cooldownKey:
      stopRetries && !filtered
        ? freeLimit
          ? PROVIDER_FREE
          : data._provider === "gemini"
            ? "gemini:all"
            : PROVIDER_ALL
        : undefined,
    modelCooldown:
      status === 404 && !formatUnsupported
        ? 300
        : [403, 429, 503].includes(status) && !filtered
          ? Math.max(30, retryAfter)
          : 0,
  });
}

export async function responseError(response, signal) {
  let data = {};
  try {
    data = await withDeadline(() => response.json(), {
      timeoutMs: 2000,
      signal,
    });
  } catch {
    signal?.throwIfAborted();
  } finally {
    cancelStream(response.body);
  }
  return providerError(data, response.status, response.headers);
}

export function checkProviderCooldown(cooldowns, model, now = Date.now()) {
  for (const key of [
    ...(String(model).startsWith("gemini-direct/")
      ? ["gemini:all"]
      : [PROVIDER_ALL]),
    ...(isFreeModel(model) ? [PROVIDER_FREE] : []),
  ]) {
    const until = cooldowns?.get(key) || 0;
    if (until > now)
      throw Object.assign(new Error("busy"), {
        kind: "busy",
        status: 429,
        stopRetries: true,
        retryAfter: Math.ceil((until - now) / 1000),
      });
  }
}

export function createAttemptBudget(limit) {
  let used = 0;
  return () => {
    if (used >= limit)
      throw Object.assign(new Error("attempts"), {
        kind: "attempts",
        status: 503,
        stopRetries: true,
        retryAfter: 15,
      });
    used++;
  };
}
