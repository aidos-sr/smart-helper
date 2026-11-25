import { readSSEData } from './sse.js';

// EOF alone is never success: only the server's explicit done event completes a reply.
export async function consumeAIStream(stream, handlers = {}, { signal } = {}) {
  let text = '';
  let metadata = {};
  try {
    for await (const payload of readSSEData(stream, { signal })) {
      let event;
      try { event = JSON.parse(payload); }
      catch { throw new Error('AI қате пішімдегі жауап жіберді'); }
      if (event.type === 'meta') {
        metadata = { ...metadata, ...event };
        handlers.onMeta?.(metadata);
      } else if (event.type === 'delta') {
        if (typeof event.text !== 'string') throw new Error('INVALID_STREAM');
        text += event.text;
        handlers.onDelta?.(event.text, text);
      } else if (event.type === 'done') {
        text = typeof event.text === 'string' ? event.text : text;
        if (!text.trim()) throw new Error('AI жауабы бос болды');
        const { type: _type, text: _text, ...details } = event;
        metadata = { ...metadata, ...details };
        handlers.onDone?.(text, metadata);
        return { ...metadata, text };
      } else if (event.type === 'error') {
        const error = new Error(event.error || 'AI сервисі уақытша қолжетімсіз');
        error.code = event.code;
        throw error;
      }
    }
    throw new Error('Байланыс үзілді. Жауап толық аяқталмады.');
  } catch (error) {
    error.partialText = text;
    error.metadata = metadata;
    throw error;
  }
}
