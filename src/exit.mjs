// The normal path must not call process.exit(). On Windows, Node throws
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" from src/win/async.c
// when process.exit() runs while a libuv handle is already closing (a pipe
// that has not finished flushing, or an undici socket). The process then
// dies with status 1, or with 3221226505 (0xC0000409), instead of the code
// we set. See nodejs/node#56645 and nodejs/node#64322.
// Node's own process.exit docs say to set process.exitCode and return.

import { EXIT_GRACE_MS } from './constants.mjs';

const hooks = new Set();
let finishing = null;

export function onShutdown(fn) {
  if (typeof fn !== 'function') return () => {};
  hooks.add(fn);
  return () => { hooks.delete(fn); };
}

function coerceCode(code) {
  const number = Number(code);
  if (!Number.isInteger(number) || number < 0 || number > 255) return 1;
  return number;
}

function flushStream(stream) {
  return new Promise((resolve) => {
    if (!stream || typeof stream.write !== 'function') {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const backup = setTimeout(done, 1500);
    backup.unref?.();
    const finish = () => {
      clearTimeout(backup);
      done();
    };
    try {
      if (typeof stream.once === 'function') stream.once('error', finish);
      const queued = stream.write('', finish);
      if (queued === false && typeof stream.once === 'function') stream.once('drain', finish);
    } catch {
      finish();
    }
  });
}

async function destroyAgent(agent) {
  if (!agent || typeof agent !== 'object') return;
  const method = typeof agent.destroy === 'function' ? 'destroy' : typeof agent.close === 'function' ? 'close' : '';
  if (!method) return;
  await Promise.race([
    Promise.resolve().then(() => agent[method]()).then(() => {}, () => {}),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref?.();
    }),
  ]);
}

async function closeFetchDispatcher() {
  const agents = [];
  try {
    for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
      if (String(symbol).includes('undici.globalDispatcher')) {
        const value = globalThis[symbol];
        if (value) agents.push(value);
      }
    }
  } catch { /* ignore */ }
  try {
    const undici = process.getBuiltinModule?.('undici');
    if (typeof undici?.getGlobalDispatcher === 'function') agents.push(undici.getGlobalDispatcher());
  } catch { /* Node 22.20 has no builtin undici module */ }
  const seen = new Set();
  for (const agent of agents) {
    if (seen.has(agent)) continue;
    seen.add(agent);
    await destroyAgent(agent);
  }
}

async function runHooks() {
  const list = [...hooks];
  hooks.clear();
  for (const fn of list) {
    try { await fn(); } catch { /* shutdown still continues */ }
  }
}

export async function finishProcess(code) {
  if (finishing) return finishing;
  const exitCode = coerceCode(code);
  process.exitCode = exitCode;
  finishing = (async () => {
    const fallback = setTimeout(() => {
      Promise.resolve()
        .then(() => flushStream(process.stdout))
        .then(() => flushStream(process.stderr))
        .finally(() => { process.exit(exitCode); });
    }, EXIT_GRACE_MS);
    fallback.unref?.();
    await runHooks();
    await closeFetchDispatcher();
    await flushStream(process.stdout);
    await flushStream(process.stderr);
  })();
  return finishing;
}
