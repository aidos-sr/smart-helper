import { createAIClient } from '../../lib/ai-http.js';
import { getCurrentSession, getCurrentUser, refreshCurrentSession } from './supabase.js';
export { studyProgressText } from '../../lib/ai-http.js';

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

const client = createAIClient({ getAccessToken: requireAccess, refreshSession: refreshCurrentSession });

export function requestAI(task, payload = {}, options = {}) {
  return client.send(task, payload, { onProgress: options.onProgress }, options);
}

export function requestAIStream(payload = {}, handlers = {}, options = {}) {
  return client.send('chat', payload, handlers, options);
}
