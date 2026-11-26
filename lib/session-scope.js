let owner = null,
  epoch = 0;
const active = new Set(),
  listeners = new Set();
export function setSessionOwner(userId) {
  if ((userId || null) === owner) return;
  owner = userId || null;
  epoch++;
  for (const controller of active)
    controller.abort(new DOMException("Session changed", "AbortError"));
  active.clear();
  for (const reset of listeners) reset();
}
export function onSessionReset(reset) {
  listeners.add(reset);
  return () => listeners.delete(reset);
}
export function captureSession() {
  const userId = owner,
    generation = epoch;
  return {
    userId,
    valid: () => userId === owner && generation === epoch,
    assert() {
      if (!this.valid())
        throw new DOMException("Session changed", "AbortError");
    },
  };
}
export function sessionOperation(signal) {
  const scope = captureSession(),
    controller = new AbortController();
  active.add(controller);
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  return {
    ...scope,
    signal: controller.signal,
    close() {
      active.delete(controller);
      signal?.removeEventListener("abort", cancel);
    },
  };
}
