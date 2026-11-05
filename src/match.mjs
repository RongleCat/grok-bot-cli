export function matchBot(bots, query, { exact = false } = {}) {
  const needle = query.trim();
  const folded = needle.toLowerCase();
  const byId = bots.filter(bot => bot.id === needle);
  if (byId.length === 1) return { bot: byId[0] };
  if (byId.length > 1) return { ambiguous: byId };
  const byName = bots.filter(bot => bot.name.toLowerCase() === folded);
  if (byName.length === 1) return { bot: byName[0] };
  if (byName.length > 1) return { ambiguous: byName };
  const partial = bots.filter(bot => bot.name.toLowerCase().includes(folded));
  if (exact) {
    if (partial.length) return { ambiguous: partial, inexact: true };
    return { none: true };
  }
  if (partial.length === 1) return { bot: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return { none: true };
}

export function describeCandidates(bots) {
  return bots.map(bot => `${bot.name} (${bot.id})`).join(', ');
}
