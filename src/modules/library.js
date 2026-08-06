import { getCurrentUser, getRequiredSupabaseClient } from '../services/supabase.js';

const ALLOWED_KINDS = new Set(['flashcards', 'quiz', 'planner']);

function requireUser() {
  const user = getCurrentUser();
  if (!user?.id) throw new Error('Материалды сақтау үшін жүйеге кіріңіз');
  return user;
}

export async function saveStudyMaterial(kind, title, content) {
  if (!ALLOWED_KINDS.has(kind)) throw new Error('Материал түрі дұрыс емес');
  const user = requireUser();
  const safeTitle = String(title || 'Жаңа материал').trim().slice(0, 160);
  const row = {
    user_id: user.id,
    kind,
    title: safeTitle || 'Жаңа материал',
    content,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await getRequiredSupabaseClient()
    .from('study_materials')
    .insert(row)
    .select('id,title,kind,content,updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function loadStudyMaterials(kind, limit = 30) {
  if (!ALLOWED_KINDS.has(kind)) return [];
  const user = getCurrentUser();
  if (!user?.id) return [];
  const { data, error } = await getRequiredSupabaseClient()
    .from('study_materials')
    .select('id,title,kind,content,updated_at')
    .eq('user_id', user.id)
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
    .limit(Math.min(60, Math.max(1, limit)));
  if (error) throw error;
  return data || [];
}

export async function fillMaterialSelect(selectId, kind) {
  const select = document.getElementById(selectId);
  if (!select) return [];
  const materials = await loadStudyMaterials(kind);
  select.replaceChildren(new Option('Сақталған материалдар', ''));
  materials.forEach((material) => {
    const option = new Option(material.title, material.id);
    option.dataset.material = JSON.stringify(material.content);
    select.appendChild(option);
  });
  select.hidden = materials.length === 0;
  return materials;
}

export function readSelectedMaterial(selectId) {
  const option = document.getElementById(selectId)?.selectedOptions?.[0];
  if (!option?.value || !option.dataset.material) return null;
  try { return JSON.parse(option.dataset.material); } catch { return null; }
}
