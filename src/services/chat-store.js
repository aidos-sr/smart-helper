import { safeStorage, readJSON } from "../../lib/safe-storage.js";
import { captureSession } from "../../lib/session-scope.js";
import { withDeadline } from "../../lib/deadline.js";
import { getRequiredSupabaseClient } from "./supabase.js";
const key = (uid) => "sh-chats:" + uid;
const local = (uid) => readJSON(key(uid), []);
const keep = (uid, row) => {
  const rows = [row, ...local(uid).filter((item) => item.id !== row.id)],
    pending = rows.filter((item) => item.sync !== "synced"),
    synced = rows.filter((item) => item.sync === "synced").slice(0, 10);
  return safeStorage.setItem(key(uid), JSON.stringify([...pending, ...synced]));
};
export function stageChatRow(row) {
  const scope = captureSession();
  if (scope.userId !== row.user_id)
    throw new DOMException("Session changed", "AbortError");
  return keep(row.user_id, { ...row, sync: "pending" });
}
export async function saveChatRow(row) {
  const scope = captureSession();
  if (scope.userId !== row.user_id)
    throw new DOMException("Session changed", "AbortError");
  // Postgres jsonb inserts spaces; reserve space for its serialization overhead.
  if (new TextEncoder().encode(JSON.stringify(row.messages)).length > 90000)
    throw new Error("Чат көлемі шекке жетті. Экспорттап, жаңа чат ашыңыз.");
  const saved = keep(row.user_id, { ...row, sync: "pending" });
  try {
    const { error } = await withDeadline(
      (signal) =>
        getRequiredSupabaseClient()
          .from("chats")
          .upsert(row, { onConflict: "id" })
          .abortSignal(signal),
      { timeoutMs: 8000 },
    );
    if (error) throw error;
    const latest = local(row.user_id).find((item) => item.id === row.id);
    if (latest?.updated_at === row.updated_at)
      keep(row.user_id, { ...row, sync: "synced" });
    return "cloud";
  } catch (error) {
    if (saved) return "local";
    throw error;
  }
}
export async function flushChats() {
  const scope = captureSession();
  for (const row of local(scope.userId).filter(
    (row) => row.sync === "pending",
  )) {
    scope.assert();
    const { sync, ...data } = row;
    await saveChatRow(data);
  }
}
export async function listChats(cursor = null) {
  const scope = captureSession();
  let rows = [];
  try {
    let query = getRequiredSupabaseClient()
      .from("chats")
      .select("id,title,updated_at")
      .eq("user_id", scope.userId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(20);
    if (
      cursor &&
      /^[0-9a-f-]{36}$/i.test(cursor.id) &&
      Number.isFinite(Date.parse(cursor.updated_at))
    ) {
      const stamp = new Date(cursor.updated_at).toISOString();
      query = query.or(
        `updated_at.lt.${stamp},and(updated_at.eq.${stamp},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await withDeadline(
      (signal) => query.abortSignal(signal),
      { timeoutMs: 8000 },
    );
    if (error) throw error;
    rows = data || [];
  } catch {}
  scope.assert();
  const merged = new Map(rows.map((row) => [row.id, row]));
  for (const { messages, ...row } of local(scope.userId)) {
    const other = merged.get(row.id);
    if (!other || row.updated_at >= other.updated_at) merged.set(row.id, row);
  }
  const result = [...merged.values()].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
  result.nextCursor =
    rows.length === 20
      ? { id: rows.at(-1).id, updated_at: rows.at(-1).updated_at }
      : null;
  return result;
}
export async function readChat(id) {
  const scope = captureSession(),
    cached = local(scope.userId).find((row) => row.id === id);
  if (cached?.sync === "pending") return cached;
  try {
    const { data, error } = await withDeadline(
      (signal) =>
        getRequiredSupabaseClient()
          .from("chats")
          .select("id,user_id,title,messages,updated_at")
          .eq("id", id)
          .eq("user_id", scope.userId)
          .single()
          .abortSignal(signal),
      { timeoutMs: 8000 },
    );
    if (error) throw error;
    scope.assert();
    keep(scope.userId, { ...data, sync: "synced" });
    return data;
  } catch (error) {
    scope.assert();
    if (cached) return cached;
    throw error;
  }
}
export async function deleteChat(id) {
  const scope = captureSession();
  const { error } = await withDeadline(
    (signal) =>
      getRequiredSupabaseClient()
        .from("chats")
        .delete()
        .eq("id", id)
        .eq("user_id", scope.userId)
        .abortSignal(signal),
    { timeoutMs: 8000 },
  );
  if (error) throw error;
  scope.assert();
  safeStorage.setItem(
    key(scope.userId),
    JSON.stringify(local(scope.userId).filter((row) => row.id !== id)),
  );
}
if (typeof window !== "undefined")
  window.addEventListener("online", () => flushChats().catch(() => {}));
