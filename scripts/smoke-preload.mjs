// Test-only fetch redirect. The SDK origin is fixed, so the smoke script points
// global fetch at a local mock before the CLI reads globalThis.fetch.
const origin = process.env.GROK_BOT_SMOKE_ORIGIN;
if (!origin) throw new Error('GROK_BOT_SMOKE_ORIGIN is required');
const realFetch = globalThis.fetch;
const prefixes = ['https://api2.cursor.sh', 'https://cursor.com'];

globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input?.url;
  for (const prefix of prefixes) {
    if (typeof url === 'string' && url.startsWith(prefix)) {
      return realFetch(`${origin}${url.slice(prefix.length)}`, init);
    }
  }
  return realFetch(input, init);
};
