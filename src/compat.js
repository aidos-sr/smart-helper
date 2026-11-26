// Small compatibility shims; cryptographic IDs never fall back to Math.random.
if (!AbortSignal.prototype.throwIfAborted)
  AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted)
      throw this.reason || new DOMException("Aborted", "AbortError");
  };
if (!AbortSignal.any)
  AbortSignal.any = function (signals) {
    const controller = new AbortController(),
      subscriptions = [];
    const cleanup = () => {
      for (const [signal, fn] of subscriptions)
        signal.removeEventListener("abort", fn);
    };
    for (const signal of signals) {
      const abort = () => {
        controller.abort(signal.reason);
        cleanup();
      };
      if (signal.aborted) {
        abort();
        break;
      }
      signal.addEventListener("abort", abort, { once: true });
      subscriptions.push([signal, abort]);
    }
    return controller.signal;
  };
if (globalThis.crypto?.getRandomValues && !globalThis.crypto.randomUUID)
  globalThis.crypto.randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10).join(""),
    ].join("-");
  };
