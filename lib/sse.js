// Cancellation can stay pending on an upstream connection after the final event.
// Start cleanup without holding a completed result or a fallback hostage to it.
export function cancelStream(stream) {
  try { Promise.resolve(stream?.cancel()).catch(() => {}); } catch {}
}

// Shared by the browser and the server. A network chunk is not an SSE event.
export async function* readSSEData(stream, { signal } = {}) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => { try { reader.cancel(signal.reason).catch(() => {}); } catch {} };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block.split(/\r\n|\r|\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''));
        if (data.length) yield data.join('\n');
      }
      if (buffer.length > 1_000_000) throw new Error('INVALID_STREAM');
      // An unterminated event at EOF is incomplete and must not be executed.
      if (done) break;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { reader.cancel().catch(() => {}); } catch {}
    reader.releaseLock();
  }
}
