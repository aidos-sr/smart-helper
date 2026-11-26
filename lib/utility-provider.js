import { readSSEData, cancelStream } from './sse.js';
import { withDeadline } from './deadline.js';

const RETRYABLE = new Set([400, 402, 403, 404, 408, 422, 429, 500, 502, 503, 504]);
const fail = (kind, status = 502) => Object.assign(new Error(kind), { kind, status });
const asText = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.map((part) => typeof part?.text === 'string' ? part.text : '').join('') : '';

async function readCompletion(response, signal, armIdle) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json();
    if (data.error) throw fail('unavailable', Number(data.error.code) || 502);
    const choice = data.choices?.[0];
    return { text: asText(choice?.message?.content), finishReason: choice?.finish_reason };
  }
  let text = '', finishReason;
  for await (const payload of readSSEData(response.body, { signal })) {
    if (payload === '[DONE]') break;
    let event;
    try { event = JSON.parse(payload); } catch { throw fail('protocol'); }
    const choice = event.choices?.[0];
    if (event.error || choice?.error || choice?.finish_reason === 'error') {
      throw fail('unavailable', Number(event.error?.code || choice?.error?.code) || 502);
    }
    // Some providers still emit reasoning despite enabled:false. Real tokens
    // count as activity; keep-alive comments alone do not extend this timer.
    if (choice?.delta?.reasoning || choice?.delta?.reasoning_details?.length) armIdle();
    const delta = asText(choice?.delta?.content);
    if (delta) { text += delta; armIdle(); }
    if (choice?.finish_reason) { finishReason = choice.finish_reason; break; }
  }
  return { text, finishReason };
}

// JSON mode works with more free endpoints than strict json_schema. Both modes
// use the same local validator; prompt-only fallback never bypasses validation.
export async function generateUtility({
  modelRequest, models, request, validate, signal, deadline,
  firstTokenTimeoutMs = 25_000, idleTimeoutMs = 25_000, attemptTimeoutMs = 65_000, cooldowns = new Map(), onAttempt = () => {}
}) {
  const schema = modelRequest.response_format?.json_schema?.schema;
  const messages = [...modelRequest.messages];
  if (schema) messages.splice(1, 0, {
    role: 'system',
    content: `Return only one complete JSON object. No markdown, comments or extra prose. Follow this schema exactly: ${JSON.stringify(schema)}`
  });
  let lastFailure = fail('unavailable');
  let tokenLimit = modelRequest.max_tokens;
  for (const model of [...new Set(models)].filter(Boolean)) {
    if ((cooldowns.get(model) || 0) > Date.now()) continue;
    let mode = schema ? 'json' : 'text';
    let repaired = false;
    let attemptMessages = messages;
    // A format downgrade or one content repair can retry this model once.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted();
      const remaining = deadline - Date.now();
      if (remaining < 1500) throw fail('timeout', 504);
      const startedAt = Date.now();
      const report = (outcome) => { try { onAttempt({ model, outcome, elapsedMs: Date.now() - startedAt }); } catch {} };
      try {
        const result = await withDeadline(async (attemptSignal) => {
          const idleController = new AbortController();
          const fetchSignal = AbortSignal.any([attemptSignal, idleController.signal]);
          const abortIdle = () => idleController.abort(new DOMException('AI response timed out', 'TimeoutError'));
          let idleTimer = setTimeout(abortIdle, firstTokenTimeoutMs);
          const cancelAttempt = () => { clearTimeout(idleTimer); idleController.abort(attemptSignal.reason); };
          attemptSignal.addEventListener('abort', cancelAttempt, { once: true });
          const armIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(abortIdle, idleTimeoutMs); };
          try {
            const payload = {
              model, messages: attemptMessages, max_tokens: tokenLimit,
              temperature: 0.15, stream: true,
              provider: { allow_fallbacks: true, sort: 'throughput' },
              ...(mode !== 'prompt' ? { reasoning: { enabled: false } } : {}),
              ...(mode === 'json' ? { response_format: { type: 'json_object' } } : {})
            };
            const response = await request(payload, fetchSignal);
            if (!response.ok) {
              cancelStream(response.body);
              throw fail(response.status === 429 ? 'busy' : 'unavailable', response.status);
            }
            const result = await readCompletion(response, fetchSignal, armIdle);
            if (result.finishReason === 'length') throw Object.assign(fail('truncated'), { responseText: result.text });
            if (result.finishReason === 'content_filter') throw fail('filtered');
            if (result.finishReason !== 'stop') throw fail('interrupted');
            if (!result.text.trim()) throw fail('empty');
            try {
              return { ok: true, ...validate(result.text), model };
            } catch {
              throw Object.assign(fail('structured'), { responseText: result.text });
            }
          } finally {
            clearTimeout(idleTimer);
            attemptSignal.removeEventListener('abort', cancelAttempt);
            idleController.abort();
          }
        }, { signal, timeoutMs: Math.min(attemptTimeoutMs, remaining) });
        report('success');
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        lastFailure = error?.name === 'AbortError' || error?.name === 'TimeoutError' ? fail('timeout', 504) : error;
        if (!lastFailure.kind) lastFailure = fail('network');
        report(lastFailure.kind);
        if (lastFailure.kind === 'timeout') cooldowns.set(model, deadline);
        if ([402, 403, 429, 503].includes(lastFailure.status)) cooldowns.set(model, Date.now() + 30_000);
        if (['filtered','budget'].includes(lastFailure.kind) || lastFailure.status === 401) throw lastFailure;
        if (mode !== 'prompt' && [400, 404, 422].includes(lastFailure.status)) {
          mode = 'prompt';
          continue;
        }
        if (schema && ['structured', 'truncated'].includes(lastFailure.kind) && !repaired) {
          repaired = true;
          if (lastFailure.kind === 'truncated') tokenLimit = Math.min(8000, tokenLimit * 2);
          attemptMessages = [
            ...messages,
            { role: 'assistant', content: error.responseText?.slice(0, 14000) || '{}' },
            { role: 'user', content: 'The previous JSON is incomplete or does not match the schema. Rewrite the complete object with every requested item and all required fields. Do not shorten the item count. Return JSON only.' }
          ];
          continue;
        }
        if (lastFailure.status && !RETRYABLE.has(lastFailure.status) && !['empty', 'structured', 'truncated', 'interrupted', 'network'].includes(lastFailure.kind)) throw lastFailure;
        break;
      }
    }
  }
  throw lastFailure;
}
