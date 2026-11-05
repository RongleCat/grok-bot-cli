const SECRET_KEY = /^(access[_-]?token|refresh[_-]?token|verifier|authorization|gateway[_-]?token|network[_-]?token|password|secret)$/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(item);
  }
  return out;
}
