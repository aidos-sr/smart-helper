// Bound the entire operation, including SDK auth locks and response body reads.
export async function withDeadline(operation, { timeoutMs, signal } = {}) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(combined.reason || new DOMException('Aborted', 'AbortError'));
  combined.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  try {
    combined.throwIfAborted();
    return await Promise.race([Promise.resolve().then(() => operation(combined)), aborted]);
  } finally {
    clearTimeout(timer);
    combined.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
