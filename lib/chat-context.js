const MAX_MESSAGE_CHARS = 12_000;
const MAX_HISTORY_CHARS = 60_000;

export function selectChatHistory(value, { hasCurrentAttachments = false } = {}) {
  if (!Array.isArray(value) || value.at(-1)?.role !== 'user' ||
      typeof value.at(-1)?.content !== 'string' || !value.at(-1).content.trim()) {
    throw new Error('EMPTY_MESSAGE');
  }
  if (value.at(-1).content.length > MAX_MESSAGE_CHARS) throw new Error('MESSAGE_TOO_LONG');
  const messages = [];
  let totalChars = 0;
  // Always retain the newest question, then add complete recent turns backwards.
  for (const message of value.slice(-40).reverse()) {
    if (!['user', 'assistant'].includes(message?.role) || typeof message.content !== 'string') continue;
    if (message.incomplete === true) continue;
    let content = message.content.trim();
    if (!content) continue;
    const names = (hasCurrentAttachments && message === value.at(-1) ? [] : Array.isArray(message.attachments) ? message.attachments : [])
      .map((attachment) => typeof attachment?.name === 'string' ? attachment.name.slice(0, 120) : '')
      .filter(Boolean).slice(0, 3);
    if (names.length) content += `\n[Earlier attachment names: ${names.join(', ')}. File contents are unavailable in this turn; ask the user to reattach if needed.]`;
    if (totalChars + content.length > MAX_HISTORY_CHARS) break;
    totalChars += content.length;
    messages.unshift({ role: message.role, content });
  }
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

export function addSearchStatus(modelRequest, { enabled, status, current = false, providerSearch = false }) {
  modelRequest.messages.splice(1, 0, {
    role: 'system',
    content: `Today is ${new Date().toISOString().slice(0, 10)}. ` +
      (!enabled
        ? 'Internet search is disabled. You have no live web evidence. Do not claim to have searched or verified current facts. Ask to enable search for changing facts.'
        : providerSearch
          ? 'An online search plugin is enabled. Use only the evidence it actually returns. If it returns no usable evidence, say the answer could not be verified. Never claim current facts were verified without supporting sources.'
        : status === 'ok'
          ? 'Search excerpts follow. Use only claims actually supported by their content; a paper title or author list is not evidence of its findings. Cite only the supplied URLs. If they do not answer the question, say so.'
          : 'No usable search evidence was retrieved. Explicitly say that search did not verify the answer. Do not fabricate current facts, citations, quotes, sources or links.') +
      (current ? ' This question may require up-to-date information. Encyclopedias and academic search alone cannot establish current news, prices or officeholders.' : '')
  });
}
