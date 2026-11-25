import { getCurrentUser, getRequiredSupabaseClient } from '../services/supabase.js';
import { createMaterialCache } from '../../lib/material-cache.js';
import { withDeadline } from '../../lib/deadline.js';

const ALLOWED_KINDS = new Set(['flashcards', 'quiz', 'planner']);
const cache = createMaterialCache();
const loads = new Map();

function requireUser() {
  const user = getCurrentUser();
  if (!user?.id) throw new Error('Материалды сақтау үшін жүйеге кіріңіз');
  return user;
}

export async function saveStudyMaterial(kind, title, content) {
  if (!ALLOWED_KINDS.has(kind)) throw new Error('Материал түрі дұрыс емес');
  const user = requireUser();
  const row = {
    id: crypto.randomUUID(), user_id: user.id, kind,
    title: String(title || 'Жаңа материал').trim().slice(0, 160) || 'Жаңа материал',
    content, updated_at: new Date().toISOString()
  };
  const locallySaved = cache.put(user.id, kind, row);
  try {
    const { error } = await withDeadline((signal) => getRequiredSupabaseClient()
      .from('study_materials').upsert(row, { onConflict: 'id' }).abortSignal(signal), { timeoutMs: 8000 });
    if (error) throw error;
    return { ...row, storage: 'cloud' };
  } catch (error) {
    if (locallySaved) return { ...row, storage: 'local' };
    throw error;
  }
}

export async function loadStudyMaterials(kind, limit = 30) {
  if (!ALLOWED_KINDS.has(kind)) return [];
  const user = getCurrentUser();
  if (!user?.id) return [];
  const key = `${user.id}:${kind}`;
  if (loads.has(key)) return loads.get(key);
  const load = (async () => {
    try {
      const { data, error } = await withDeadline((signal) => getRequiredSupabaseClient()
        .from('study_materials').select('id,title,kind,content,updated_at,user_id')
        .eq('user_id', user.id).eq('kind', kind).order('updated_at', { ascending: false })
        .limit(Math.min(60, Math.max(1, limit))).abortSignal(signal), { timeoutMs: 6000 });
      if (error) throw error;
      return cache.merge(user.id, kind, data || []).rows;
    } catch { return cache.list(user.id, kind); }
  })();
  loads.set(key, load);
  try { return await load; } finally { loads.delete(key); }
}

function renderMaterialSelect(select, materials) {
  const previous = select.value;
  select.replaceChildren(new Option('Сақталған материалдар', ''));
  materials.forEach((material) => {
    const option = new Option(material.title, material.id);
    option.dataset.material = JSON.stringify(material.content);
    select.appendChild(option);
  });
  if (materials.some((material) => material.id === previous)) select.value = previous;
  select.hidden = materials.length === 0;
}

export async function fillMaterialSelect(selectId, kind) {
  const select = document.getElementById(selectId);
  const userId = getCurrentUser()?.id;
  if (!select || !userId) return [];
  renderMaterialSelect(select, cache.list(userId, kind));
  const materials = await loadStudyMaterials(kind);
  if (getCurrentUser()?.id === userId) renderMaterialSelect(select, materials);
  return materials;
}

// Saving is separate from generation: a slow or unavailable database never
// keeps the Generate button disabled or hides already generated material.
export function persistStudyMaterial(kind, title, content, selectId, onStatus) {
  const userId = getCurrentUser()?.id;
  onStatus('Дайын. Сақталуда...', 'success');
  const saving = saveStudyMaterial(kind, title, content);
  // saveStudyMaterial wrote the cache synchronously before its first await.
  const select = document.getElementById(selectId);
  if (select && userId) renderMaterialSelect(select, cache.list(userId, kind));
  saving.then((saved) => {
    if (getCurrentUser()?.id !== userId) return;
    onStatus(saved.storage === 'cloud' ? 'Дайын және сақталды' : 'Дайын. Осы құрылғыда сақталды', 'success');
  }).catch(() => {
    if (getCurrentUser()?.id === userId) onStatus('Дайын. Сақтау мүмкін болмады', 'warning');
  });
}

export function readSelectedMaterial(selectId) {
  const option = document.getElementById(selectId)?.selectedOptions?.[0];
  if (!option?.value || !option.dataset.material) return null;
  try { return JSON.parse(option.dataset.material); } catch { return null; }
}
