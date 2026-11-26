import { safeStorage } from "./safe-storage.js";
export function createMaterialCache({
  storage = safeStorage,
  limit = 30,
} = {}) {
  const storageKey = (userId, kind) => `sh-materials-v1:${userId}:${kind}`;
  // Pending entries are the only copy: never evict them to satisfy the LRU.
  const sort = (rows) => {
    const sorted = [...rows].sort((a, b) =>
      String(b.updated_at).localeCompare(String(a.updated_at)),
    );
    return [
      ...sorted.filter((row) => row.sync !== "synced"),
      ...sorted.filter((row) => row.sync === "synced").slice(0, limit),
    ];
  };
  const list = (userId, kind) => {
    if (!userId) return [];
    try {
      const rows = JSON.parse(
        storage?.getItem(storageKey(userId, kind)) || "[]",
      );
      return Array.isArray(rows)
        ? sort(
            rows.filter(
              (row) =>
                row?.id &&
                row.user_id === userId &&
                row.kind === kind &&
                row.content &&
                typeof row.content === "object",
            ),
          )
        : [];
    } catch {
      return [];
    }
  };
  const merge = (userId, kind, incoming) => {
    const byId = new Map(list(userId, kind).map((row) => [row.id, row]));
    for (const row of incoming) {
      if (
        row?.user_id !== userId ||
        row.kind !== kind ||
        !row.id ||
        !row.content
      )
        continue;
      const previous = byId.get(row.id);
      if (!previous || String(row.updated_at) >= String(previous.updated_at))
        byId.set(row.id, row);
    }
    const rows = sort([...byId.values()]);
    let saved = false;
    try {
      if (storage)
        saved =
          storage.setItem(storageKey(userId, kind), JSON.stringify(rows)) !==
          false;
    } catch {}
    return { rows, saved };
  };
  const remove = (userId, kind, id) =>
    storage.setItem(
      storageKey(userId, kind),
      JSON.stringify(list(userId, kind).filter((row) => row.id !== id)),
    );
  return {
    list,
    merge,
    remove,
    put: (userId, kind, row) => merge(userId, kind, [row]).saved,
  };
}
