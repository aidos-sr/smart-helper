import { adminClient, authenticateRequest } from "../lib/server-auth.js";
import { checkBody, authStatus } from "../lib/server-policy.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const json = (status, data) => res.status(status).json(data);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(405, { error: "Тек POST" });
  }
  try {
    checkBody(req, 1000);
    const user = await authenticateRequest(req);
    if (!user) return json(401, { error: "Жүйеге кіріңіз" });
    const action = req.body?.action;
    if (!["delete", "export"].includes(action))
      return json(400, { error: "Белгісіз әрекет" });
    const db = adminClient();
    if (action === "delete") {
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (error) throw error;
      return json(200, { deleted: true });
    }
    const result = {
      exportedAt: new Date().toISOString(),
      account: { id: user.id, email: user.email },
    };
    for (const table of ["chats", "study_materials", "progress"]) {
      result[table] = [];
      for (let from = 0; from < 1000; from += 100) {
        const { data, error } = await db
          .from(table)
          .select("*")
          .eq("user_id", user.id)
          .order(table === "progress" ? "user_id" : "id")
          .range(from, from + 99);
        if (error) throw error;
        result[table].push(...data);
        if (data.length < 100) break;
      }
    }
    return json(200, result);
  } catch (error) {
    return json(error.status === 413 ? 413 : authStatus(error), {
      error: "Әрекет орындалмады. Кейін қайталаңыз.",
    });
  }
}
