import {
  getCurrentUser,
  getRequiredSupabaseClient,
} from "../services/supabase.js";
import { createMaterialCache } from "../../lib/material-cache.js";
import { withDeadline } from "../../lib/deadline.js";
import { captureSession, onSessionReset } from "../../lib/session-scope.js";
import { normalizeStructuredResult } from "../../lib/structured-results.js";
const kinds = ["flashcards", "quiz", "planner"],
  cache = createMaterialCache(),
  objects = new Map(),
  loads = new Map();
const selectLoads = new Map();
onSessionReset(() => {
  objects.clear();
  loads.clear();
});
const request = (operation) => withDeadline(operation, { timeoutMs: 8000 });
const cloudRow = (row) => {
  const { sync, storage, ...data } = row;
  return data;
};
export function validateMaterial(kind, content) {
  if (content?.formatVersion > 2)
    throw new Error("Материал нұсқасы қолдау таппайды");
  const data = normalizeStructuredResult(kind, content, {
    ...content,
    count: content?.questions?.length,
    days: content?.days?.length,
  });
  return { ...content, ...data };
}
export async function saveStudyMaterial(
  kind,
  title,
  content,
  owner = getCurrentUser()?.id,
  id = crypto.randomUUID(),
) {
  const scope = captureSession();
  if (!kinds.includes(kind) || !owner || owner !== scope.userId)
    throw new DOMException("Session changed", "AbortError");
  content = validateMaterial(kind, content);
  if (new TextEncoder().encode(JSON.stringify(content)).length > 180000)
    throw new Error("Материал тым үлкен. Экспорттаңыз.");
  const row = {
    id,
    user_id: owner,
    kind,
    title: String(title || "Жаңа материал")
      .trim()
      .slice(0, 160),
    content: { ...content, formatVersion: 2 },
    folder:
      cache.list(owner, kind).find((item) => item.id === id)?.folder ||
      content.folder ||
      "",
    tags:
      cache.list(owner, kind).find((item) => item.id === id)?.tags ||
      content.tags ||
      [],
    updated_at: new Date().toISOString(),
    sync: "pending",
  };
  const saved = cache.put(owner, kind, row);
  objects.set(id, row);
  try {
    scope.assert();
    const { error } = await request((signal) =>
      getRequiredSupabaseClient()
        .from("study_materials")
        .upsert(cloudRow(row), { onConflict: "id" })
        .abortSignal(signal),
    );
    if (error) throw error;
    cache.put(owner, kind, { ...row, sync: "synced" });
    return { ...row, storage: "cloud" };
  } catch (error) {
    if (saved) return { ...row, storage: "local" };
    throw error;
  }
}
export async function flushMaterials() {
  const scope = captureSession();
  if (!scope.userId) return;
  for (const kind of kinds)
    for (const row of cache
      .list(scope.userId, kind)
      .filter((row) => row.sync !== "synced")) {
      scope.assert();
      const { error } = await request((signal) =>
        getRequiredSupabaseClient()
          .from("study_materials")
          .upsert(cloudRow(row), { onConflict: "id" })
          .abortSignal(signal),
      );
      if (error) throw error;
      cache.put(scope.userId, kind, { ...row, sync: "synced" });
    }
}
export async function loadStudyMaterials(
  kind,
  limit = 30,
  offset = 0,
  search = "",
) {
  const scope = captureSession();
  if (!scope.userId || !kinds.includes(kind)) return [];
  const key = `${scope.userId}:${kind}:${offset}:${search}`;
  if (loads.has(key)) return loads.get(key);
  const pending = (async () => {
    let cloud = [];
    try {
      let query = getRequiredSupabaseClient()
        .from("study_materials")
        .select("id,title,kind,updated_at,user_id,folder,tags")
        .eq("user_id", scope.userId)
        .eq("kind", kind)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(offset, offset + limit - 1);
      if (search) {
        const term = search
          .replace(/[^\p{L}\p{N} _-]/gu, "")
          .trim()
          .slice(0, 80);
        if (term)
          query = query.or(
            `title.ilike.%${term}%,folder.ilike.%${term}%,tags.cs.{${term}}`,
          );
      }
      const { data, error } = await request((signal) =>
        query.abortSignal(signal),
      );
      if (error) throw error;
      cloud = data || [];
    } catch {}
    scope.assert();
    const local = cache
      .list(scope.userId, kind)
      .filter(
        (row) =>
          !search ||
          [row.title, row.folder, ...(row.tags || [])]
            .filter(Boolean)
            .some((value) =>
              value.toLowerCase().includes(search.toLowerCase()),
            ),
      );
    local.forEach((row) => objects.set(row.id, row));
    return [...mergeMetadata(cloud, local)].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
  })();
  loads.set(key, pending);
  try {
    return await pending;
  } finally {
    loads.delete(key);
  }
}
function render(select, materials) {
  const previous = select.value;
  select.replaceChildren(new Option("Сақталған материалдар", ""));
  for (const material of materials)
    select.append(
      new Option(
        (material.folder ? material.folder + " / " : "") +
          material.title +
          (material.sync === "pending" ? " · құрылғыда" : ""),
        material.id,
      ),
    );
  if (materials.some((row) => row.id === previous)) select.value = previous;
  select.hidden = false;
}
export async function fillMaterialSelect(id, kind, offset = 0, search = "") {
  const scope = captureSession(),
    select = document.getElementById(id);
  if (!select || !scope.userId) return [];
  const version = (selectLoads.get(id) || 0) + 1;
  selectLoads.set(id, version);
  const rows = await loadStudyMaterials(kind, 30, offset, search);
  scope.assert();
  if (selectLoads.get(id) === version) render(select, rows);
  return rows;
}
export function persistStudyMaterial(
  kind,
  title,
  content,
  selectId,
  onStatus,
  owner = getCurrentUser()?.id,
  id,
) {
  const scope = captureSession();
  if (owner !== scope.userId || !scope.valid()) return;
  onStatus("Дайын. Сақталуда...", "success");
  saveStudyMaterial(kind, title, content, owner, id)
    .then((saved) => {
      if (!scope.valid()) return;
      onStatus(
        saved.storage === "cloud"
          ? "Дайын және сақталды"
          : "Дайын. Осы құрылғыда; бұлтқа жіберілуі күтілуде",
        "success",
      );
      fillMaterialSelect(selectId, kind).catch(() => {});
    })
    .catch(() => {
      if (scope.valid())
        onStatus("Сақталмады. Материалды экспорттаңыз", "warning");
    });
}
export async function readSelectedMaterial(selectId) {
  const scope = captureSession(),
    id = document.getElementById(selectId)?.value;
  if (!id || !scope.userId) return null;
  let row = objects.get(id);
  if (!row) {
    const { data, error } = await request((signal) =>
      getRequiredSupabaseClient()
        .from("study_materials")
        .select("id,title,kind,content,updated_at,user_id,folder,tags")
        .eq("id", id)
        .eq("user_id", scope.userId)
        .single()
        .abortSignal(signal),
    );
    if (error) throw error;
    scope.assert();
    row = data;
    objects.set(id, row);
    cache.put(scope.userId, row.kind, { ...row, sync: "synced" });
  }
  scope.assert();
  if (row.user_id !== scope.userId) throw new Error("Материал қолжетімсіз");
  return {
    ...validateMaterial(row.kind, row.content),
    materialId: row.id,
    folder: row.folder || "",
    tags: row.tags || [],
  };
}
export async function deleteMaterial(selectId) {
  const scope = captureSession(),
    id = document.getElementById(selectId)?.value;
  if (!id) return;
  const { error } = await request((signal) =>
    getRequiredSupabaseClient()
      .from("study_materials")
      .delete()
      .eq("id", id)
      .eq("user_id", scope.userId)
      .abortSignal(signal),
  );
  if (error) throw error;
  scope.assert();
  for (const kind of kinds) cache.remove(scope.userId, kind, id);
  objects.delete(id);
  document.getElementById(selectId).selectedOptions[0]?.remove();
}
export async function renameMaterial(selectId, title) {
  const scope = captureSession(),
    id = document.getElementById(selectId)?.value;
  if (!id || !title?.trim()) return;
  const { error } = await request((signal) =>
    getRequiredSupabaseClient()
      .from("study_materials")
      .update({
        title: title.trim().slice(0, 160),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", scope.userId)
      .abortSignal(signal),
  );
  if (error) throw error;
  scope.assert();
  const row = objects.get(id);
  if (row) {
    row.title = title;
    cache.put(scope.userId, row.kind, row);
  }
  document.getElementById(selectId).selectedOptions[0].textContent = title;
}
if (typeof window !== "undefined")
  window.addEventListener("online", () => flushMaterials().catch(() => {}));

export async function organizeMaterial(selectId, folder, tags) {
  const scope = captureSession(),
    saved = await readSelectedMaterial(selectId);
  if (!saved) return;
  scope.assert();
  folder = String(folder || "")
    .trim()
    .slice(0, 80);
  tags = [
    ...new Set(
      String(tags || "")
        .split(",")
        .map((s) => s.trim().slice(0, 30))
        .filter(Boolean),
    ),
  ].slice(0, 12);
  const { error } = await request((signal) =>
    getRequiredSupabaseClient()
      .from("study_materials")
      .update({ folder, tags })
      .eq("id", saved.materialId)
      .eq("user_id", scope.userId)
      .abortSignal(signal),
  );
  if (error) throw error;
  scope.assert();
  const row = objects.get(saved.materialId);
  row.folder = folder;
  row.tags = tags;
  cache.put(scope.userId, row.kind, row);
  document.getElementById(selectId).selectedOptions[0].textContent =
    (folder ? folder + " / " : "") + row.title;
}

function mergeMetadata(cloud, local) {
  const map = new Map(local.map((row) => [row.id, row]));
  for (const row of cloud) {
    const cached = map.get(row.id);
    if (!cached || row.updated_at > cached.updated_at) {
      map.set(row.id, row);
      objects.delete(row.id);
    }
  }
  return map.values();
}
