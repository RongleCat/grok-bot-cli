// A reply belongs to a sent message when it sits strictly after that message in
// transcript order and strictly before the next user turn.
//
// The anchor is the entry whose entry id, body id, or message id equals
// --message-id, or whose entry id equals getSendStatus.echoEntryId.
// A user turn is only a message whose role is user. A send-message entry is the
// bot's send-message tool, so it counts as a bot reply even when it has no
// assistant role. Assistant text is also role assistant, kind assistant-text,
// or kind message that is not a user turn. Streaming entries (streaming /
// isStreaming) mean the turn is still open, so the reply is not complete yet.
// The newest 500 entries are the window. Older anchors are not guessed from
// earlier assistant text; the caller watches for text that arrives after the call.

function seqValue(entry) {
  try {
    return BigInt(entry?.seq ?? 0);
  } catch {
    return 0n;
  }
}

function bodyOf(entry) {
  const body = entry?.body;
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function entryPlainText(entry) {
  const body = bodyOf(entry);
  if (!body) return '';
  if (typeof body.content === 'string') return body.content;
  if (typeof body.text === 'string') return body.text;
  if (typeof body.message?.content === 'string') return body.message.content;
  return '';
}

function isStreaming(entry) {
  const body = bodyOf(entry);
  if (!body) return false;
  return body.streaming === true || body.isStreaming === true || body.message?.streaming === true || body.message?.isStreaming === true;
}

function idMatches(value, messageId, echoEntryId) {
  return typeof value === 'string' && value.length > 0 && (value === messageId || (echoEntryId && value === echoEntryId));
}

export function entryReferencesMessage(entry, messageId, echoEntryId = null) {
  const body = bodyOf(entry);
  return idMatches(entry?.entryId, messageId, echoEntryId)
    || idMatches(body?.id, messageId, echoEntryId)
    || idMatches(body?.messageId, messageId, echoEntryId)
    || idMatches(body?.clientMessageId, messageId, echoEntryId)
    || idMatches(body?.message?.id, messageId, echoEntryId)
    || idMatches(body?.message?.messageId, messageId, echoEntryId);
}

function entryKindText(entry) {
  const body = bodyOf(entry);
  return `${entry?.entryKind || ''} ${body?.kind || ''}`.toLowerCase();
}

export function isUserTurn(entry) {
  const body = bodyOf(entry);
  if (!body) return false;
  // send-message is the bot tool that posts a reply. It is not a user turn.
  if (entryKindText(entry).includes('send-message')) return false;
  const role = String(body.role || body.message?.role || '').toLowerCase();
  return role === 'user';
}

export function isAssistantEntry(entry) {
  if (isUserTurn(entry)) return false;
  const body = bodyOf(entry);
  const kind = String(body?.kind || entry?.entryKind || '').toLowerCase();
  const role = String(body?.role || body?.message?.role || '').toLowerCase();
  if (kind.includes('send-message')) return true;
  if (role === 'assistant') return true;
  if (kind === 'assistant-text' || kind === 'assistant' || kind === 'assistant-message') return true;
  if (kind === 'message' && role !== 'user') return true;
  return false;
}

export function findReplyAfterMessage(entries, messageId, { echoEntryId = null } = {}) {
  const sorted = [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    const a = seqValue(left);
    const b = seqValue(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const anchorIndex = sorted.findIndex(entry => entryReferencesMessage(entry, messageId, echoEntryId));
  if (anchorIndex < 0) return { foundAnchor: false, complete: false, text: '', anchorText: '' };
  const anchorText = entryPlainText(sorted[anchorIndex]).trim();
  const texts = [];
  let streaming = false;
  for (const entry of sorted.slice(anchorIndex + 1)) {
    if (isUserTurn(entry) && !entryReferencesMessage(entry, messageId, echoEntryId)) break;
    if (!isAssistantEntry(entry)) continue;
    if (isStreaming(entry)) {
      streaming = true;
      continue;
    }
    const text = entryPlainText(entry).trim();
    if (text && text !== anchorText) texts.push(text);
  }
  if (streaming || texts.length === 0) {
    return { foundAnchor: true, complete: false, text: '', anchorText };
  }
  return { foundAnchor: true, complete: true, text: texts.join('\n\n'), anchorText };
}
