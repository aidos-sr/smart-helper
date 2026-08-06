import { getCurrentSession, getCurrentUser, refreshCurrentSession } from './supabase.js';

export async function requestAI(task, payload = {}, options = {}, mayRetry = true) {
  const user = getCurrentUser();
  const session = getCurrentSession();
  if (!user || !session?.access_token) {
    if (options.onAuthRequired) options.onAuthRequired();
    else document.dispatchEvent(new CustomEvent('smart-helper:auth-required'));
    throw new Error('AI қолдану үшін жүйеге кіріңіз');
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ task, ...payload })
  });

  if (response.status === 401 && mayRetry) {
    await refreshCurrentSession();
    return requestAI(task, payload, options, false);
  }

  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'AI сервисі уақытша қолжетімсіз');
  return data;
}
