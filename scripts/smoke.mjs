#!/usr/bin/env node
// Local smoke for dist/grok-bot.mjs under node and bun. No real account calls.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = path.join(CLI, 'dist', 'grok-bot.mjs');
const PRELOAD = path.join(CLI, 'scripts', 'smoke-preload.mjs');
const PROBE = path.join(CLI, 'scripts', 'runtime-probe.mjs');
const TOKEN = 'fixture-access-token';
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 500) });
  if (!ok) process.stderr.write(`FAIL ${name}${detail ? `: ${detail}` : ''}\n`);
}

function cleanEnv(dir, extra = {}) {
  const env = { ...process.env, GROK_BOT_CONFIG_DIR: dir };
  delete env.GROK_BOT_ACCESS_TOKEN;
  return { ...env, ...extra };
}

function spawnCollected(command, args, env, timeoutMs) {
  const child = spawn(command, args, { cwd: CLI, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let settled = false;
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`timeout ${command} ${args.join(' ')}`));
    }, timeoutMs);
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    child.once('error', error => finish(() => reject(error)));
    child.once('close', (code, signal) => finish(() => resolve({ code, signal, stdout, stderr })));
  });
  return { child, done, text: () => stdout };
}

function run(command, args, env, timeoutMs = 15000) {
  return spawnCollected(command, args, env, timeoutMs).done;
}

function framed(data, flag = 0) {
  const payload = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function live(isRunning) {
  return framed({
    agentState: {
      snapshot: false,
      live: [{ agentId: 'bot-alpha', sessionId: '', isRunning, isComposingMessage: false, isRetrying: false, hasRunningSubagents: false }],
    },
  });
}

function textFrame(text, seq, entryId) {
  return framed({
    rows: {
      agentId: 'bot-alpha',
      sessionId: '',
      generation: 1,
      entries: [{
        seq,
        updatedSeq: seq,
        entryId,
        entryKind: 'send-message',
        body: Buffer.from(JSON.stringify({ id: entryId, kind: 'send-message', message: { type: 'text', content: text } })).toString('base64'),
      }],
    },
  });
}

function startServer() {
  let watchRes = null;
  const paths = [];
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const pathName = (req.url ?? '').split('?')[0];
      paths.push(pathName);
      const json = (body, status = 200) => {
        const text = JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
        res.end(text);
      };
      if (pathName.endsWith('/ListGrokBotAgents')) {
        json({ agents: [{ agentId: 'bot-alpha', name: 'Alpha', title: 'A', role: 'main', viewerSessionId: 'sess-a' }], truncated: false });
        return;
      }
      if (pathName.endsWith('/ListGrokBotTranscriptEntries')) {
        json({ generation: 1, entries: [{ seq: '1', updatedSeq: '1' }] });
        return;
      }
      if (pathName.endsWith('/SendGrokBotUserMessage')) {
        json({ delivery: 1, dispatched: true });
        if (watchRes && !watchRes.writableEnded) {
          watchRes.write(live(true));
          watchRes.write(textFrame('the reply', '3', 'reply-1'));
          watchRes.write(live(false));
          watchRes.write(framed({}, 2));
          watchRes.end();
        }
        return;
      }
      if (pathName.endsWith('/WatchGrokBotTranscripts')) {
        res.writeHead(200, { 'content-type': 'application/connect+json' });
        res.socket?.setNoDelay(true);
        res.write(framed({ connected: { serverTimeMs: '1', absoluteLifetimeMs: '2' } }));
        watchRes = res;
        return;
      }
      json({ code: 'not_found' }, 404);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(error instanceof Error ? error.message : 'error');
    }
  });
  server.requestTimeout = 0;
  server.timeout = 0;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        paths: () => paths.slice(),
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

function cliArgs(runtime, userArgs, preload) {
  if (!preload) return [BUNDLE, ...userArgs];
  if (runtime === 'bun') return ['--preload', PRELOAD, BUNDLE, ...userArgs];
  return ['--import', pathToFileURL(PRELOAD).href, BUNDLE, ...userArgs];
}

function runtimeCommand(runtime) {
  return runtime === 'bun' ? 'bun' : process.execPath;
}

async function cli(runtime, userArgs, env, { preload = false, timeoutMs = 15000 } = {}) {
  return run(runtimeCommand(runtime), cliArgs(runtime, userArgs, preload), env, timeoutMs);
}

async function versionHelpStatusLogin(runtime, dir) {
  const env = cleanEnv(dir);
  const version = await cli(runtime, ['--version'], env);
  check(`${runtime} version exit`, version.code === 0, `code=${version.code} ${version.stderr}`);
  check(`${runtime} version text`, /grok-bot 0\.1\.0/.test(version.stdout) && /grok-bot-target 0\.75\.8/.test(version.stdout) && new RegExp(`runtime ${runtime} v`).test(version.stdout), version.stdout);
  const versionJson = await cli(runtime, ['--version', '--json'], env);
  let parsed = null;
  try { parsed = JSON.parse(versionJson.stdout); } catch { parsed = null; }
  check(`${runtime} version json`, versionJson.code === 0 && parsed?.ok === true && parsed.runtime === runtime && typeof parsed.runtimeVersion === 'string', versionJson.stdout);
  const help = await cli(runtime, ['--help'], env);
  check(`${runtime} help`, help.code === 0 && help.stdout.includes('RUNTIME_UNSUPPORTED'), `code=${help.code}`);
  const status = await cli(runtime, ['status', '--json'], env);
  let statusBody = null;
  try { statusBody = JSON.parse(status.stdout); } catch { statusBody = null; }
  check(`${runtime} status logged out`, status.code === 2 && statusBody?.error?.code === 'NOT_LOGGED_IN', status.stdout || status.stderr);
  const started = await cli(runtime, ['login', '--start', '--json', '--no-open'], env);
  let loginBody = null;
  try { loginBody = JSON.parse(started.stdout); } catch { loginBody = null; }
  const pendingPath = path.join(dir, 'profiles', 'default.pending.json');
  let pendingMode = null;
  let pending = null;
  try {
    pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    pendingMode = (await stat(pendingPath)).mode & 0o777;
  } catch { pending = null; }
  const printed = `${started.stdout}\n${started.stderr}`;
  const loginOk = started.code === 0
    && loginBody?.ok === true
    && typeof loginBody.loginUrl === 'string'
    && loginBody.loginUrl.startsWith('https://cursor.com/loginDeepControl?')
    && !printed.includes('verifier')
    && pendingMode === 0o600
    && typeof pending?.verifier === 'string'
    && !printed.includes(pending.verifier);
  check(`${runtime} login start`, loginOk, `code=${started.code} mode=${pendingMode}`);
  const loggedOut = await cli(runtime, ['logout', '--json'], env);
  let gone = false;
  try { await stat(pendingPath); } catch (error) { gone = error?.code === 'ENOENT'; }
  check(`${runtime} logout clears pending`, loggedOut.code === 0 && gone, `code=${loggedOut.code}`);
}

async function httpSmoke(runtime) {
  const dir = await mkdtemp(path.join(tmpdir(), `grok-bot-http-${runtime}-`));
  const server = await startServer();
  try {
    const env = cleanEnv(dir, { GROK_BOT_ACCESS_TOKEN: TOKEN, GROK_BOT_SMOKE_ORIGIN: server.origin });
    const bots = await cli(runtime, ['bots', '--json'], env, { preload: true });
    let body = null;
    try { body = JSON.parse(bots.stdout); } catch { body = null; }
    check(`${runtime} bots`, bots.code === 0 && body?.count === 1 && body.bots?.[0]?.id === 'bot-alpha', bots.stderr || bots.stdout);
    const sent = await cli(runtime, ['send', '--bot', 'alpha', '--text', 'hello bot', '--wait', '--idle-timeout', '0', '--timeout', '10', '--json'], env, { preload: true, timeoutMs: 20000 });
    let sentBody = null;
    try { sentBody = JSON.parse(sent.stdout); } catch { sentBody = null; }
    check(`${runtime} send --wait`, sent.code === 0 && sentBody?.text === 'the reply' && sentBody?.endedBy === 'agent-idle' && sentBody?.botId === 'bot-alpha', `code=${sent.code} ${sent.stderr || sent.stdout}`);
    check(`${runtime} http paths`, server.paths().some(item => item.endsWith('/WatchGrokBotTranscripts')) && server.paths().some(item => item.endsWith('/SendGrokBotUserMessage')), server.paths().join(','));
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function signalSmoke(runtime) {
  const dir = await mkdtemp(path.join(tmpdir(), `grok-bot-sig-${runtime}-`));
  const server = await startServer();
  const env = cleanEnv(dir, { GROK_BOT_ACCESS_TOKEN: TOKEN, GROK_BOT_SMOKE_ORIGIN: server.origin });
  const launched = spawnCollected(runtimeCommand(runtime), cliArgs(runtime, ['watch', '--bot', 'bot-alpha', '--json'], true), env, 12000);
  try {
    const started = Date.now();
    let sawConnected = false;
    while (Date.now() - started < 8000) {
      if (launched.text().includes('"type":"connected"') || launched.text().includes('connected')) {
        sawConnected = true;
        break;
      }
      if (launched.child.exitCode != null || launched.child.signalCode) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    check(`${runtime} watch connected`, sawConnected, launched.text().slice(0, 300));
    launched.child.kill('SIGINT');
    const result = await launched.done;
    check(`${runtime} sigint exit`, result.code === 0, `code=${result.code} signal=${result.signal} stderr=${result.stderr}`);
  } catch (error) {
    check(`${runtime} sigint exit`, false, error.message);
    if (launched.child.exitCode == null && !launched.child.signalCode) launched.child.kill('SIGKILL');
  } finally {
    await server.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

async function symlinkSmoke(runtime, dir) {
  const bin = path.join(dir, 'grok-bot');
  await symlink(BUNDLE, bin);
  const env = cleanEnv(dir);
  if (runtime === 'node') {
    const result = await run(bin, ['--version'], env);
    check('symlink shebang version', result.code === 0 && /runtime node v/.test(result.stdout), result.stderr || result.stdout);
    return;
  }
  const result = await run('bun', [bin, '--version'], env);
  check('bun symlink version', result.code === 0 && /runtime bun v/.test(result.stdout), result.stderr || result.stdout);
}

async function probe(runtime) {
  const result = await run(runtimeCommand(runtime), [PROBE, '--marker'], process.env, 10000);
  let body = null;
  try { body = JSON.parse(result.stdout); } catch { body = null; }
  check(`${runtime} probe exit`, result.code === 0 && body, result.stderr || result.stdout);
  if (!body) return null;
  check(`${runtime} probe mode 0600`, body.mode === 0o600, String(body.mode));
  check(`${runtime} probe crypto`, body.uuid === true && body.pbkdf2Length === 16 && body.hashLength > 0 && (body.decipher === 'available' || body.decipher === 'ok'), body.decipher);
  check(`${runtime} probe execFile`, body.execFileTrue === 'ok', body.execFileTrue);
  const argv = body.argv ?? [];
  const marker = argv.at(-1) === '--marker';
  check(`${runtime} probe argv marker`, marker, JSON.stringify(argv));
  return { argv, execPath: body.execPath, versions: body.versions };
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'grok-bot-smoke-'));
  const probes = {};
  try {
    for (const runtime of ['node', 'bun']) {
      const dir = path.join(root, runtime);
      await import('node:fs/promises').then(fs => fs.mkdir(dir, { recursive: true }));
      probes[runtime] = await probe(runtime);
      await versionHelpStatusLogin(runtime, dir);
      await httpSmoke(runtime);
      await signalSmoke(runtime);
      await symlinkSmoke(runtime, dir);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const failed = checks.filter(item => !item.ok);
  process.stdout.write(`${JSON.stringify({ failed: failed.length, checks, probes }, null, 2)}\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
