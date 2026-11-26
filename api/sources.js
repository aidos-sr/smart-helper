import { searchStudySources } from "../lib/study-sources.js";
import { adminClient, authenticateRequest } from "../lib/server-auth.js";
import {
  checkBody,
  authStatus,
  reserveAttempt,
  leaseJob,
  checkpoint,
} from "../lib/server-policy.js";
export default async function handler(req, res) {
  const requestId = crypto.randomUUID();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Request-ID", requestId);
  const json = (code, data) => res.status(code).json({ ...data, requestId });
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(405, { error: "Тек POST" });
  }
  let user, id;
  try {
    try {
      checkBody(req, 4000);
    } catch {
      return json(413, { error: "Сұрау тым үлкен" });
    }
    if (
      typeof req.body.query !== "string" ||
      req.body.query.length > 1000 ||
      Object.keys(req.body).some((key) => key !== "query")
    )
      return json(400, { error: "Іздеу сұрауы дұрыс емес" });
    try {
      user = await authenticateRequest(req);
    } catch (error) {
      return json(authStatus(error), {
        error: "Кіруді тексеру уақытша қолжетімсіз",
      });
    }
    if (!user) return json(401, { error: "Жүйеге кіріңіз" });
    await reserveAttempt(adminClient(), user.id, "search");
    id = crypto.randomUUID();
    const job = await leaseJob(
      adminClient(),
      user.id,
      id,
      { query: req.body.query },
      "search",
    );
    if (job.error) {
      id = null;
      res.setHeader("Retry-After", "10");
      return json(429, { error: "Басқа тапсырма орындалуда" });
    }
    return json(200, await searchStudySources(req.body.query));
  } catch (error) {
    res.setHeader("Retry-After", String(error.retryAfter || 60));
    return json(error.status || 503, { error: "Іздеу уақытша қолжетімсіз" });
  } finally {
    if (id && user)
      await checkpoint(adminClient(), user.id, id, {
        status: "complete",
        result: {},
        lease_until: new Date().toISOString(),
      }).catch(() => {});
  }
}
