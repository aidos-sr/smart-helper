const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
// Keep every character, including a single long AI answer, below the jsonb row limit.
export function paginateChatMessages(
  messages,
  maxBytes = 80000,
  maxMessages = 40,
) {
  const parts = [];
  for (const message of messages) {
    if (bytes([message]) <= maxBytes) {
      parts.push(message);
      continue;
    }
    const characters = Array.from(message.content || "");
    let at = 0;
    while (at < characters.length) {
      let low = 1,
        high = characters.length - at;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (
          bytes([
            {
              ...message,
              content: characters.slice(at, at + middle).join(""),
              segment: true,
            },
          ]) <= maxBytes
        )
          low = middle;
        else high = middle - 1;
      }
      parts.push({
        ...message,
        content: characters.slice(at, at + low).join(""),
        segment: true,
      });
      at += low;
    }
  }
  const pages = [];
  let current = [];
  for (const part of parts) {
    if (
      current.length &&
      (current.length >= maxMessages || bytes([...current, part]) > maxBytes)
    ) {
      pages.push(current);
      current = [];
    }
    current.push(part);
  }
  if (current.length) pages.push(current);
  return pages;
}
