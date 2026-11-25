import { readSSEData, cancelStream } from './sse.js';

const RETRYABLE = new Set([400, 402, 403, 404, 408, 429, 500, 502, 503, 504]);

function deltaText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((part) => part?.text || '').join('') : '';
}

// Fallback is allowed only before visible text. Switching models halfway through
// an answer would silently mix two different solutions.
export async function generateChatStream({
  attempts, modelRequest, request, onEvent, signal,
  deadline = Date.now() + 52_000,
  firstTokenTimeoutMs = 12_000, idleTimeoutMs = 15_000,
  maxContinuations = 1
}) {
  let text = '';
  let failure = 'unavailable';
  let continuations = 0;
  let currentMessages = modelRequest.messages;
  const sources = new Map();

  for (let index = 0; index < attempts.length; index++) {
    const remaining = deadline - Date.now();
    if (remaining < 1_000) { failure = 'timeout'; break; }
    const { model } = attempts[index];
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const abort = () => controller.abort(new DOMException('AI request timed out', 'TimeoutError'));
    const totalTimer = setTimeout(abort, remaining);
    let idleTimer = setTimeout(abort, Math.min(firstTokenTimeoutMs, remaining));
    let finishReason = null;
    let actualModel = model;
    let segmentText = '';
    let announced = false;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(abort, Math.min(idleTimeoutMs, Math.max(1, deadline - Date.now())));
    };

    try {
      const response = await request({ model, messages: currentMessages, signal: requestSignal });
      if (!response.ok || !response.body) {
        // Consume the error body without logging prompts, tokens or user data.
        cancelStream(response.body);
        failure = response.status === 429 ? 'busy' : 'unavailable';
        if (!RETRYABLE.has(response.status) || text) break;
        continue;
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        cancelStream(response.body);
        failure = 'protocol';
        if (text) break;
        continue;
      }

      for await (const payload of readSSEData(response.body, { signal: requestSignal })) {
        if (payload === '[DONE]') break;
        let event;
        try { event = JSON.parse(payload); }
        catch { throw new Error('INVALID_STREAM'); }
        const choice = event.choices?.[0];
        if (event.error || choice?.error || choice?.finish_reason === 'error') {
          throw new Error('UPSTREAM_STREAM_ERROR');
        }
        actualModel = event.model || actualModel;
        for (const annotation of choice?.delta?.annotations || choice?.message?.annotations || []) {
          const citation = annotation?.type === 'url_citation' ? annotation.url_citation : null;
          if (citation && sources.size < 6) {
            try {
              if (new URL(citation.url).protocol === 'https:') {
                sources.set(citation.url, { title: citation.title || citation.url, url: citation.url });
              }
            } catch {}
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = deltaText(choice?.delta?.content);
        if (delta) {
          resetIdle();
          if (!announced) {
            onEvent({ type: 'meta', model: actualModel, fallback: index > 0 });
            announced = true;
          }
          segmentText += delta;
          text += delta;
          onEvent({ type: 'delta', text: delta });
        }
        if (finishReason) break;
        // Provider comments/reasoning do not reset the first-answer timeout.
      }
      if (!segmentText.trim()) {
        failure = finishReason === 'content_filter' ? 'filtered' : 'empty';
        if (text || failure === 'filtered') break;
        continue;
      }
      if (finishReason === 'stop') {
        return { ok: true, text, model: actualModel, finishReason, incomplete: false, sources: [...sources.values()] };
      }
      if (finishReason === 'length') {
        if (continuations < maxContinuations && deadline - Date.now() >= 5_000) {
          continuations++;
          currentMessages = [
            ...modelRequest.messages,
            { role: 'assistant', content: text },
            { role: 'user', content: 'Continue exactly where the previous answer stopped. Do not repeat it. Keep the same language and finish the original task.' }
          ];
          // Continue with the same model; this is part of the same quota request.
          index--;
          continue;
        }
        return { ok: true, text, model: actualModel, finishReason, incomplete: true, sources: [...sources.values()] };
      }
      failure = finishReason === 'content_filter' ? 'filtered' : 'interrupted';
      break;
    } catch (error) {
      failure = requestSignal.aborted
        ? signal?.aborted ? 'cancelled' : 'timeout'
        : 'interrupted';
      if (text || signal?.aborted) break;
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      controller.abort();
    }
  }
  return { ok: false, kind: failure, text, hadDelta: Boolean(text.trim()) };
}
