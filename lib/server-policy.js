import { createHash } from "node:crypto";
export function providerPolicy() {
  const price = Number(process.env.AI_MAX_PRICE_PER_MILLION || 1);
  return {
    allow_fallbacks: true,
    sort: "throughput",
    data_collection: "deny",
    ...(process.env.AI_REQUIRE_ZDR === "true" ? { zdr: true } : {}),
    max_price: { prompt: price, completion: price },
    ...(process.env.AI_ALLOWED_PROVIDERS
      ? {
          only: process.env.AI_ALLOWED_PROVIDERS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  };
}
export function mayUsePaid(user) {
  return (
    process.env.AI_PAID_ENABLED === "true" &&
    (process.env.AI_PAID_USER_IDS || "").split(",").includes(user.id)
  );
}
export function pseudonym(userId) {
  return createHash("sha256")
    .update(
      `${process.env.AI_PROVIDER === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENROUTER_API_KEY}:${userId}`,
    )
    .digest("hex")
    .slice(0, 32);
}
export function checkBody(req, maxBytes = 4 * 1024 * 1024) {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Buffer.byteLength(JSON.stringify(body), "utf8") > maxBytes
  )
    throw Object.assign(new Error("INVALID_BODY"), { status: 413 });
}
export function authStatus(error) {
  return error?.status === 401 ||
    error?.status === 403 ||
    ["bad_jwt", "session_not_found", "user_not_found"].includes(error?.code)
    ? 401
    : 503;
}
export async function reserveAttempt(admin, userId, channel = "ai") {
  const { data, error } = await admin.rpc("reserve_ai_attempt", {
    p_user_id: userId,
    p_channel: channel,
    p_global_limit: Number(process.env.AI_GLOBAL_ATTEMPTS_PER_DAY || 2000),
    p_user_limit: channel === "search" ? 10 : 20,
  });
  if (error) throw error;
  if (!data?.allowed)
    throw Object.assign(new Error(data?.reason || "ATTEMPT_LIMIT"), {
      status: 429,
      retryAfter: data?.retryAfter || 60,
    });
}
export async function leaseJob(admin, userId, operationId, body, task) {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: "2026-11-25.2",
        provider: process.env.AI_PROVIDER || "openrouter",
        geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        models: Object.fromEntries(
          Object.entries(process.env).filter(([key]) =>
            /^OPENROUTER_.*MODEL$/.test(key),
          ),
        ),
        body,
      }),
    )
    .digest("hex");
  const { data, error } = await admin.rpc("claim_ai_job", {
    p_user_id: userId,
    p_id: operationId,
    p_hash: hash,
    p_task: task,
    p_params: body,
    p_project_limit: Number(process.env.AI_PROJECT_CONCURRENCY || 10),
  });
  if (error) throw error;
  return data;
}
export async function checkpoint(admin, userId, id, patch, signal) {
  let query = admin
    .from("ai_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
  if (signal) query = query.abortSignal(signal);
  const { error } = await query;
  if (error) throw error;
}
