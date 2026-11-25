import { consumeAIStream } from '../../lib/ai-client-stream.js';
import { getCurrentSession, getCurrentUser, refreshCurrentSession } from './supabase.js';

function requireAccess(options = {}) {
  const user = getCurrentUser();
  const session = getCurrentSession();
  if (!user || !session?.access_token) {
    if (options.onAuthRequired) options.onAuthRequired();
    else document.dispatchEvent(new CustomEvent('smart-helper:auth-required'));
    throw new Error('AI қолдану үшін жүйеге кіріңіз');
  }
  return session.access_token;
}

export async function requestAI(task, payload = {}, options = {}, mayRetry = true) {
  const accessToken = requireAccess(options);
  const response = await fetch('/api/chat', {
    method: 'POST',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ ...payload, task })
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

export async function requestAIStream(payload = {}, handlers = {}, options = {}, mayRetry = true) {
  const accessToken = requireAccess(options);
  const response = await fetch('/api/chat', {
    method: 'POST',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(65_000)]) : AbortSignal.timeout(65_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ ...payload, task: 'chat', stream: true })
  });

  if (response.status === 401 && mayRetry) {
    await refreshCurrentSession();
    return requestAIStream(payload, handlers, options, false);
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'AI сервисі уақытша қолжетімсіз');
  }
  if (!response.body) throw new Error('AI ағынын оқу мүмкін болмады');

  return consumeAIStream(response.body, handlers, { signal: options.signal });
}
