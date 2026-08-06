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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
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

export async function requestAIStream(payload = {}, handlers = {}, options = {}, mayRetry = true) {
  const accessToken = requireAccess(options);
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ task: 'chat', stream: true, ...payload })
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let metadata = {};
  let completed = false;

  const processBlock = (block) => {
    const dataText = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!dataText) return;
    let event;
    try { event = JSON.parse(dataText); } catch { return; }
    if (event.type === 'meta') {
      metadata = event;
      handlers.onMeta?.(event);
    } else if (event.type === 'delta') {
      fullText += event.text || '';
      handlers.onDelta?.(event.text || '', fullText);
    } else if (event.type === 'done') {
      completed = true;
      fullText = event.text || fullText;
      handlers.onDone?.(fullText, metadata);
    } else if (event.type === 'error') {
      throw new Error(event.error || 'AI сервисі уақытша қолжетімсіз');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach(processBlock);
  }
  if (buffer.trim()) processBlock(buffer);
  if (!completed && !fullText.trim()) throw new Error('AI жауабы бос болды');
  if (!completed) handlers.onDone?.(fullText.trim(), metadata);
  return { text: fullText.trim(), ...metadata };
}
