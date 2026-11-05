import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, programArgs } from '../src/args.mjs';
import { configDir } from '../src/config.mjs';
import { runCli } from '../src/cli.mjs';
import { DEFAULT_TIMEOUT_SEC, LOGIN_WAIT_SEC, MAX_TIMEOUT_SEC, STATUS_PROBE_INTERVAL_MS } from '../src/constants.mjs';
import { detectRuntime, formatRuntimeVersion } from '../src/runtime.mjs';
import { createTurnWait } from '../src/wait.mjs';
import { redact } from '../src/redact.mjs';

const ACCESS = 'fixture-access-token';
const REFRESH = 'fixture-refresh-token';
const EMAIL = 'hidden@example.com';

function capture() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    stdout: { write(chunk) { out.push(String(chunk)); return true; } },
    stderr: { write(chunk) { err.push(String(chunk)); return true; } },
    text() { return out.join(''); },
    json() { return JSON.parse(out.join('')); },
  };
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'grok-bot-cli-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function framed(data, flag = 0) {
  const payload = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function frameResponse(frames) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  }), { headers: { 'content-type': 'application/connect+json' } });
}

function live(isRunning, extra = {}) {
  return framed({
    agentState: {
      snapshot: false,
      live: [{ agentId: 'bot-alpha', sessionId: '', isRunning, isComposingMessage: false, isRetrying: false, hasRunningSubagents: false, ...extra }],
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

const ROSTER = {
  agents: [
    { agentId: 'bot-alpha', name: 'Alpha', title: 'A', role: 'main', viewerSessionId: 'sess-a' },
    { agentId: 'bot-alpine', name: 'Alpine', title: 'B', role: 'main', viewerSessionId: 'sess-b' },
    { agentId: 'bot-beta', name: 'Beta', title: 'C', role: 'side', viewerSessionId: 'sess-c' },
  ],
  truncated: false,
};

function run(dir, argv, extras = {}) {
  const io = capture();
  const calls = [];
  const fetchImpl = extras.fetchImpl ?? (async (url) => {
    calls.push(String(url));
    throw new Error(`unexpected fetch ${url}`);
  });
  const promise = runCli({
    argv,
    env: { GROK_BOT_CONFIG_DIR: dir, ...extras.env },
    stdout: io.stdout,
    stderr: io.stderr,
    fetchImpl,
    now: extras.now ?? (() => 1_700_000_000_000),
    sleep: extras.sleep ?? (async () => {}),
    openBrowser: extras.openBrowser ?? (async () => {}),
    platform: 'darwin',
    homedir: dir,
    ...extras.runtime ? { runtime: extras.runtime } : {},
  });
  return { io, calls, promise };
}

test('program arguments drop the runtime entry and keep user args', () => {
  assert.deepEqual(programArgs(['node', '/app/src/main.mjs', '--version']), ['--version']);
  assert.deepEqual(programArgs(['/bin/grok-bot', '--version']), ['--version']);
  assert.deepEqual(programArgs(['/bin/grok-bot', '/bin/grok-bot', 'status', '--json']), ['status', '--json']);
  assert.deepEqual(programArgs(['bun', '/$bunfs/root/grok-bot-darwin-arm64', 'status', '--json']), ['status', '--json']);
  assert.deepEqual(programArgs(['node', '/app/src/main.mjs', 'bots']), ['bots']);
  assert.deepEqual(programArgs(['/usr/local/bin/node', '/usr/local/bin/grok-bot', 'status', '--json']), ['status', '--json']);
  assert.deepEqual(programArgs(['/opt/ada/.bun/bin/bun', '/opt/ada/dist/grok-bot.mjs', '--version']), ['--version']);
  assert.deepEqual(programArgs(['C:\\Program Files\\nodejs\\node.exe', 'C:\\npm\\grok-bot.mjs', 'bots']), ['bots']);
  assert.deepEqual(programArgs(['/bin/grok-bot', '/tmp/note.txt']), ['/tmp/note.txt']);
});

test('config directories follow the platform defaults', () => {
  assert.equal(configDir({ platform: 'darwin', env: {}, homedir: '/home/ada' }), '/home/ada/Library/Application Support/grok-bot-cli');
  assert.equal(configDir({ platform: 'linux', env: {}, homedir: '/home/ada' }), '/home/ada/.config/grok-bot-cli');
  assert.equal(configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/ada' }), '/xdg/grok-bot-cli');
  assert.equal(configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, homedir: 'C:\\Users\\ada' }), 'C:\\Users\\ada\\AppData\\Roaming\\grok-bot-cli');
  assert.equal(configDir({ platform: 'darwin', env: { GROK_BOT_CONFIG_DIR: '/tmp/override' }, homedir: '/home/ada' }), '/tmp/override');
});

test('version, help, and bad arguments use the JSON shape and exit codes', async () => {
  await withDir(async (dir) => {
    const runtime = detectRuntime();
    const version = run(dir, ['--version', '--json']);
    assert.equal(await version.promise, 0);
    assert.deepEqual(version.io.json(), {
      ok: true,
      version: '0.78.1',
      targetVersion: '0.78.1',
      runtime: runtime.name,
      runtimeVersion: formatRuntimeVersion(runtime.version),
    });
    assert.equal(version.calls.length, 0);

    const human = run(dir, ['--version']);
    assert.equal(await human.promise, 0);
    assert.match(human.io.text(), /grok-bot 0\.78\.1/);
    assert.match(human.io.text(), /grok-bot-target 0\.78\.1/);
    assert.match(human.io.text(), new RegExp(`runtime ${runtime.name} v`));

    const help = run(dir, ['--help']);
    assert.equal(await help.promise, 0);
    assert.match(help.io.text(), /Exit codes:/);
    assert.match(help.io.text(), /RUNTIME_UNSUPPORTED/);
    assert.match(help.io.text(), /Default --timeout is 600s/);
    assert.match(help.io.text(), /maximum is 3600s/);
    assert.match(help.io.text(), /Default wait is 300s/);
    assert.match(help.io.text(), /status-idle/);
    assert.equal(DEFAULT_TIMEOUT_SEC, 600);
    assert.equal(LOGIN_WAIT_SEC, 300);
    assert.equal(MAX_TIMEOUT_SEC, 3600);

    const allowed = parseArgs(['send', '--bot', 'a', '--text', 'hi', '--wait', '--timeout', '3600']);
    assert.equal(allowed.ok, true);
    assert.equal(allowed.timeout, 3600);
    const over = run(dir, ['send', '--bot', 'alpha', '--text', 'hi', '--wait', '--timeout', '3601', '--json']);
    assert.equal(await over.promise, 3);
    assert.match(over.io.json().error.message, /1 to 3600/);

    const missing = run(dir, ['--json']);
    assert.equal(await missing.promise, 3);
    assert.equal(missing.io.json().ok, false);
    assert.equal(missing.io.json().error.code, 'USAGE');
    assert.equal(typeof missing.io.json().error.message, 'string');

    const extra = run(dir, ['bots', '--text', 'nope', '--json']);
    assert.equal(await extra.promise, 3);
    assert.equal(extra.io.json().error.code, 'USAGE');
  });
});

test('old Node and old Bun exit 3 before any command', async () => {
  await withDir(async (dir) => {
    const oldNode = run(dir, ['--version', '--json'], { runtime: { name: 'node', version: '22.12.9' } });
    assert.equal(await oldNode.promise, 3);
    assert.equal(oldNode.io.json().error.code, 'RUNTIME_UNSUPPORTED');
    assert.match(oldNode.io.json().error.message, /Node\.js 22 LTS/);
    assert.match(oldNode.io.json().error.message, /Bun/);

    const exact = run(dir, ['--version', '--json'], { runtime: { name: 'node', version: '22.13.0' } });
    assert.equal(await exact.promise, 0);
    assert.equal(exact.io.json().runtime, 'node');
    assert.equal(exact.io.json().runtimeVersion, 'v22.13.0');

    const oldBun = run(dir, ['status', '--json'], { runtime: { name: 'bun', version: '1.0.0' } });
    assert.equal(await oldBun.promise, 3);
    assert.equal(oldBun.io.json().error.code, 'RUNTIME_UNSUPPORTED');
    assert.equal(oldBun.calls.length, 0);

    const bunOnOldNodeCompat = run(dir, ['--version'], { runtime: { name: 'bun', version: '1.1.0' } });
    assert.equal(await bunOnOldNodeCompat.promise, 0);
    assert.match(bunOnOldNodeCompat.io.text(), /runtime bun v1\.1\.0/);

    const prefersBun = run(dir, ['--version', '--json'], { runtime: detectRuntime({ bun: '1.3.10', node: '18.0.0' }) });
    assert.equal(await prefersBun.promise, 0);
    assert.equal(prefersBun.io.json().runtime, 'bun');
    assert.equal(prefersBun.io.json().runtimeVersion, 'v1.3.10');
  });
});

test('status without credentials exits 2 and does not call the network', async () => {
  await withDir(async (dir) => {
    const status = run(dir, ['status', '--json']);
    assert.equal(await status.promise, 2);
    const body = status.io.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'NOT_LOGGED_IN');
    assert.match(body.error.credentialPath, /profiles[\\/]default\.json$/);
    assert.equal(status.calls.length, 0);
    assert.equal(status.io.err.join(''), '');
  });
});

test('redaction removes credential fields from JSON output', () => {
  assert.equal(redact({ accessToken: ACCESS, nested: { refreshToken: REFRESH, name: 'Ada' } }).nested.name, 'Ada');
  assert.equal(redact({ accessToken: ACCESS }).accessToken, '[redacted]');
  assert.equal(JSON.stringify(redact({ verifier: 'abc' })).includes('abc'), false);
});

test('two-step login stores mode 0600 credentials and never prints tokens', async () => {
  await withDir(async (dir) => {
    const opened = [];
    const started = run(dir, ['login', '--start', '--json', '--no-open'], { openBrowser: async (url) => opened.push(url) });
    assert.equal(await started.promise, 0);
    assert.equal(opened.length, 0);
    assert.equal(started.calls.length, 0);
    const startBody = started.io.json();
    assert.equal(startBody.ok, true);
    assert.match(startBody.loginUrl, /^https:\/\/cursor\.com\/loginDeepControl\?/);
    assert.equal(Number.isNaN(Date.parse(startBody.expiresAt)), false);
    const pendingPath = join(dir, 'profiles', 'default.pending.json');
    const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    if (process.platform !== 'win32') assert.equal((await stat(pendingPath)).mode & 0o777, 0o600);
    assert.equal(started.io.text().includes(pending.verifier), false);
    assert.equal(started.io.err.join('').includes(pending.verifier), false);

    let polls = 0;
    const waited = run(dir, ['login', '--wait', '--json', '--timeout', '30'], {
      fetchImpl: async (url) => {
        if (!String(url).includes('/auth/poll')) throw new Error(`unexpected ${url}`);
        polls += 1;
        if (polls === 1) return jsonResponse({}, 404);
        return jsonResponse({ accessToken: ACCESS, refreshToken: REFRESH, selectedTeamId: 7 });
      },
    });
    assert.equal(await waited.promise, 0);
    const savedPath = join(dir, 'profiles', 'default.json');
    const saved = JSON.parse(await readFile(savedPath, 'utf8'));
    assert.equal(saved.accessToken, ACCESS);
    assert.equal(saved.refreshToken, REFRESH);
    assert.equal(saved.selectedTeamId, 7);
    if (process.platform !== 'win32') assert.equal((await stat(savedPath)).mode & 0o777, 0o600);
    await assert.rejects(stat(pendingPath), /ENOENT/);
    const printed = `${waited.io.text()}\n${waited.io.err.join('')}`;
    assert.equal(printed.includes(ACCESS), false);
    assert.equal(printed.includes(REFRESH), false);
    assert.equal(printed.includes(pending.verifier), false);
    assert.equal(waited.io.json().accessTokenPresent, true);

    const browser = run(dir, ['login', '--start', '--no-open', '--profile', 'other']);
    assert.equal(await browser.promise, 0);
    const openedRun = run(dir, ['login', '--start', '--profile', 'opened'], { openBrowser: async (url) => opened.push(url) });
    assert.equal(await openedRun.promise, 0);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^https:\/\/cursor\.com\/loginDeepControl\?/);
  });
});

test('logout removes credentials and an environment token overrides the file', async () => {
  await withDir(async (dir) => {
    const profile = join(dir, 'profiles');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(profile, { recursive: true });
    const file = join(profile, 'default.json');
    await writeFile(file, `${JSON.stringify({ accessToken: 'file-token', refreshToken: REFRESH })}\n`, { mode: 0o600 });
    let authorization = '';
    const status = run(dir, ['status', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: 'env-token' },
      fetchImpl: async (url, init) => {
        authorization = init.headers.authorization;
        if (String(url).endsWith('/GetMe')) return jsonResponse({ authId: 'user', email: EMAIL, name: 'Ada', teamId: 4 });
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(await status.promise, 0);
    assert.equal(authorization, 'Bearer env-token');
    assert.equal(status.io.text().includes(EMAIL), false);
    assert.equal(status.io.text().includes('Ada'), false);
    assert.equal(status.io.text().includes('env-token'), false);
    assert.equal(status.io.json().account.emailPresent, true);
    assert.equal(status.io.json().source, 'env');

    const loggedOut = run(dir, ['logout', '--json']);
    assert.equal(await loggedOut.promise, 0);
    assert.equal(loggedOut.io.json().removed, true);
    await assert.rejects(stat(file), /ENOENT/);
  });
});

test('bot names match exactly, partially, or return the candidate list', async () => {
  await withDir(async (dir) => {
    const fetchImpl = async (url) => {
      const target = String(url);
      if (target.endsWith('/ListGrokBotAgents')) return jsonResponse(ROSTER);
      if (target.endsWith('/ListGrokBotAgentSessions')) return jsonResponse({ sessions: [{ agentId: 'bot-beta', sessionId: 'sess-c', kind: 'main' }] });
      throw new Error(`unexpected ${target}`);
    };
    const exact = run(dir, ['sessions', '--bot', 'Beta', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl,
    });
    assert.equal(await exact.promise, 0);
    assert.equal(exact.io.json().botId, 'bot-beta');
    assert.equal(exact.io.json().count, 1);

    const partial = run(dir, ['sessions', '--bot', 'bet', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl,
    });
    assert.equal(await partial.promise, 0);
    assert.equal(partial.io.json().botId, 'bot-beta');

    const ambiguous = run(dir, ['sessions', '--bot', 'alp', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async (url) => {
        if (String(url).endsWith('/ListGrokBotAgents')) return jsonResponse(ROSTER);
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(await ambiguous.promise, 3);
    assert.equal(ambiguous.io.json().error.code, 'AMBIGUOUS_BOT');
    assert.match(ambiguous.io.json().error.message, /Alpha/);
    assert.match(ambiguous.io.json().error.message, /Alpine/);
    assert.equal(ambiguous.io.json().error.candidates.length, 2);

    const missing = run(dir, ['sessions', '--bot', 'missing', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async (url) => jsonResponse(ROSTER),
    });
    assert.equal(await missing.promise, 3);
    assert.equal(missing.io.json().error.code, 'BOT_NOT_FOUND');
  });
});

test('send --wait ends on the desktop idle signal and skips the user echo', async () => {
  await withDir(async (dir) => {
    const sends = [];
    const fetchImpl = async (url, init) => {
      const target = String(url);
      if (target.endsWith('/ListGrokBotAgents')) return jsonResponse(ROSTER);
      if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [{ seq: '1', updatedSeq: '1' }] });
      if (target.endsWith('/SendGrokBotUserMessage')) {
        sends.push(JSON.parse(init.body));
        return jsonResponse({ delivery: 1, dispatched: true });
      }
      if (target.endsWith('/WatchGrokBotTranscripts')) {
        return frameResponse([
          framed({ connected: { serverTimeMs: '1', absoluteLifetimeMs: '2' } }),
          live(true),
          textFrame('hello bot', '2', 'echo-1'),
          textFrame('the reply', '3', 'reply-1'),
          live(false),
          framed({}, 2),
        ]);
      }
      throw new Error(`unexpected ${target}`);
    };
    const sent = run(dir, ['send', '--bot', 'alpha', '--text', 'hello bot', '--wait', '--idle-timeout', '0', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl,
    });
    assert.equal(await sent.promise, 0);
    const body = sent.io.json();
    assert.equal(body.ok, true);
    assert.equal(body.botId, 'bot-alpha');
    assert.equal(body.text, 'the reply');
    assert.equal(body.endedBy, 'agent-idle');
    assert.equal(body.delivery, 'accepted-box');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].text, 'hello bot');
    assert.equal(sends[0].agentId, 'bot-alpha');
  });
});

test('send --wait confirms an entry reply with status when no busy sample arrives', async () => {
  await withDir(async (dir) => {
    const fetchImpl = async (url, init) => {
      const target = String(url);
      if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
      if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [{ seq: '4', updatedSeq: '4' }] });
      if (target.endsWith('/SendGrokBotUserMessage')) return jsonResponse({ delivery: 'GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_TEMPORAL', dispatched: true });
      if (target.endsWith('/ListGrokBotAgentStatuses')) {
        return jsonResponse({ statuses: [{ agentId: 'bot-alpha', isRunning: false, live: null }] });
      }
      if (target.endsWith('/WatchGrokBotTranscripts')) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(framed({ connected: { serverTimeMs: '1' } }));
            controller.enqueue(framed({
              rows: {
                agentId: 'bot-alpha',
                sessionId: '',
                generation: 1,
                entries: [{
                  seq: '5',
                  updatedSeq: '5',
                  entryId: 'entry-1',
                  entryKind: 'message',
                  body: Buffer.from(JSON.stringify({ id: 'entry-1', kind: 'message', role: 'assistant', content: 'from entry' })).toString('base64'),
                }],
              },
            }));
            const stop = () => {
              try { controller.error(init?.signal?.reason ?? new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
            };
            if (init?.signal?.aborted) stop();
            else init?.signal?.addEventListener('abort', stop, { once: true });
          },
        }), { headers: { 'content-type': 'application/connect+json' } });
      }
      throw new Error(`unexpected ${target}`);
    };
    const sent = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'ping', '--wait', '--idle-timeout', '0', '--timeout', '5', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl,
    });
    assert.equal(await sent.promise, 0);
    assert.equal(sent.io.json().text, 'from entry');
    assert.equal(sent.io.json().endedBy, 'status-idle');
    assert.equal(sent.io.json().delivery, 'accepted-temporal');
  });
});

test('turn wait follows running, composing, streaming, and failure', () => {
  const waiter = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'hello bot', startedAt: 0 });
  assert.equal(waiter.push({ type: 'agent.state', data: { live: [{ isRunning: false, isComposingMessage: true }] } }, 5), null);
  assert.equal(waiter.push({ type: 'message', data: { entryId: 'echo', text: 'hello bot', replay: false } }, 6), null);
  const draft = waiter.push({ type: 'entry', data: { entryId: 'draft', entry: { kind: 'message', role: 'assistant', content: 'partial', isStreaming: true } } }, 7);
  assert.equal(draft.probe, true);
  assert.equal(draft.done, undefined);
  const settling = waiter.push({ type: 'agent.state', data: { live: [{ isRunning: false, isComposingMessage: false }] } }, 8);
  assert.equal(settling.probe, true);
  assert.equal(settling.reason, undefined);
  const done = waiter.push({ type: 'entry', data: { entryId: 'draft', entry: { kind: 'message', role: 'assistant', content: 'final answer', isStreaming: false } } }, 9);
  assert.equal(done.reason, 'agent-idle');
  assert.equal(done.text, 'final answer');

  const quiet = createTurnWait({ timeoutMs: 10_000, idleMs: 1000, userText: 'q', startedAt: 0 });
  assert.equal(quiet.push({ type: 'message', data: { entryId: 'm', text: 'only text' } }, 10), null);
  assert.equal(quiet.poll(1009), null);
  const probed = quiet.poll(1010);
  assert.equal(probed.probe, true);
  assert.equal(probed.final, false);
  assert.equal(quiet.noteStatus(true, 1010), null);
  assert.equal(quiet.poll(2000), null);
  assert.equal(quiet.poll(1010 + STATUS_PROBE_INTERVAL_MS).probe, true);
  assert.equal(quiet.noteStatus(false, 1010 + STATUS_PROBE_INTERVAL_MS).reason, 'status-idle');

  const late = createTurnWait({ timeoutMs: 1000, idleMs: 5000, userText: 'q', startedAt: 0 });
  assert.equal(late.push({ type: 'message', data: { entryId: 'm', text: 'partial' } }, 10), null);
  assert.equal(late.poll(1000).final, true);
  assert.equal(late.noteStatus(true, 1000, { final: true }).reason, 'timeout');
  assert.equal(late.noteStatus(true, 1000, { final: true }).text, 'partial');

  const saved = createTurnWait({ timeoutMs: 1000, idleMs: 5000, userText: 'q', startedAt: 0 });
  saved.push({ type: 'message', data: { entryId: 'm', text: 'done' } }, 10);
  assert.equal(saved.noteStatus(false, 1000, { final: true }).reason, 'status-idle');

  const subs = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'q', startedAt: 0 });
  assert.equal(subs.push({ type: 'agent.state', data: { live: [{ isRunning: false, hasRunningSubagents: true }] } }, 1), null);
  assert.equal(subs.push({ type: 'message', data: { entryId: 'm', text: '正在查…' } }, 2).probe, true);
  assert.equal(subs.noteStatus(true, 2), null);

  const snap = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'q', startedAt: 0 });
  snap.push({ type: 'agent.state', data: { live: [{ isRunning: true }] } }, 1);
  snap.push({ type: 'message', data: { entryId: 'm', text: 'done' } }, 2);
  assert.equal(snap.push({ type: 'agent.state', data: { snapshot: true, live: [] } }, 3).reason, 'agent-idle');

  const ignored = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'q', startedAt: 0 });
  ignored.push({ type: 'agent.state', data: { live: [{ isRunning: true }] } }, 1);
  ignored.push({ type: 'message', data: { entryId: 'm', text: 'done' } }, 2);
  const still = ignored.push({ type: 'agent.state', data: { live: [] } }, 3);
  assert.equal(still.probe, true);
  assert.equal(still.reason, undefined);

  const noText = createTurnWait({ timeoutMs: 1000, idleMs: 0, userText: 'q', startedAt: 0 });
  assert.equal(noText.poll(1000).reason, 'timeout');
  assert.equal(noText.poll(1000).probe, undefined);

  const failed = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'q', startedAt: 0 });
  const failure = failed.push({ type: 'turn.failed', data: { summary: 'boom', code: 7 } }, 3);
  assert.equal(failure.ok, false);
  assert.equal(failure.reason, 'turn-failed');
  assert.equal(failure.summary, 'boom');
});

function hangFrames(init, frames) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      const stop = () => {
        try { controller.error(init?.signal?.reason ?? new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
      };
      if (init?.signal?.aborted) stop();
      else init?.signal?.addEventListener('abort', stop, { once: true });
    },
  }), { headers: { 'content-type': 'application/connect+json' } });
}

function statusBody(running, extra = {}) {
  return jsonResponse({
    statuses: [{
      agentId: 'bot-alpha',
      isRunning: running,
      live: {
        agentId: 'bot-alpha',
        sessionId: '',
        isRunning: running,
        isComposingMessage: false,
        isRetrying: false,
        hasRunningSubagents: false,
        ...extra,
      },
    }],
  });
}

function entryFrame(content, seq = '5') {
  return framed({
    rows: {
      agentId: 'bot-alpha',
      sessionId: '',
      generation: 1,
      entries: [{
        seq,
        updatedSeq: seq,
        entryId: 'entry-1',
        entryKind: 'message',
        body: Buffer.from(JSON.stringify({ id: 'entry-1', kind: 'message', role: 'assistant', content })).toString('base64'),
      }],
    },
  });
}

test('send --wait ends status-idle when a stuck running flag is contradicted by status', async () => {
  await withDir(async (dir) => {
    let probes = 0;
    const sent = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'ping', '--wait', '--idle-timeout', '0', '--timeout', '30', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/SendGrokBotUserMessage')) return jsonResponse({ delivery: 1, dispatched: true });
        if (target.endsWith('/ListGrokBotAgentStatuses')) {
          probes += 1;
          return statusBody(false);
        }
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          return hangFrames(init, [
            framed({ connected: { serverTimeMs: '1' } }),
            live(true),
            entryFrame('final answer'),
          ]);
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await sent.promise, 0);
    assert.equal(sent.io.json().text, 'final answer');
    assert.equal(sent.io.json().endedBy, 'status-idle');
    assert.equal(probes, 1);
  });
});

test('progress text stays a timeout while status says the bot is running', async () => {
  await withDir(async (dir) => {
    let now = 1_700_000_000_000;
    let probes = 0;
    let sentId = '';
    const sent = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'ping', '--wait', '--idle-timeout', '0', '--timeout', '5', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      now: () => now,
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/SendGrokBotUserMessage')) {
          sentId = JSON.parse(init.body).messageId;
          return jsonResponse({ delivery: 1, dispatched: true });
        }
        if (target.endsWith('/ListGrokBotAgentStatuses')) {
          probes += 1;
          if (probes === 1) now += 10_000;
          return statusBody(true, { hasRunningSubagents: true });
        }
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          return hangFrames(init, [framed({ connected: { serverTimeMs: '1' } }), textFrame('正在查…', '5', 'progress-1')]);
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await sent.promise, 5);
    const error = sent.io.json().error;
    assert.equal(error.code, 'TIMEOUT');
    assert.equal(error.exitCode, 5);
    assert.equal(error.sent, true);
    assert.equal(error.messageId, sentId);
    assert.match(error.text, /正在查/);
    assert.match(error.message, new RegExp(`wait --bot default:bot-alpha --message-id ${sentId}`));
    assert.ok(probes >= 2);
  });
});

test('a last status check at the deadline accepts the reply when the bot has stopped', async () => {
  await withDir(async (dir) => {
    let now = 1_700_000_000_000;
    let probes = 0;
    const sent = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'ping', '--wait', '--idle-timeout', '0', '--timeout', '5', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      now: () => now,
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/SendGrokBotUserMessage')) return jsonResponse({ delivery: 1, dispatched: true });
        if (target.endsWith('/ListGrokBotAgentStatuses')) {
          probes += 1;
          if (probes === 1) {
            now += 10_000;
            return statusBody(true);
          }
          return statusBody(false);
        }
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          return hangFrames(init, [framed({ connected: { serverTimeMs: '1' } }), textFrame('最终答案', '5', 'final-1')]);
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await sent.promise, 0);
    assert.equal(sent.io.json().text, '最终答案');
    assert.equal(sent.io.json().endedBy, 'status-idle');
    assert.equal(probes, 2);
  });
});

test('send passes attachment paths and a server error exits 4', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'note.txt');
    await writeFile(file, 'hello');
    let sent;
    const attachment = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'read this', '--file', file, '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
        if (target.endsWith('/SendGrokBotUserMessage')) {
          sent = JSON.parse(init.body);
          return jsonResponse({ delivery: 2, dispatched: true });
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await attachment.promise, 0);
    assert.equal(sent.attachmentNames[0], 'note.txt');
    assert.equal(sent.attachmentPaths[0], file);
    assert.equal(attachment.io.json().delivery, 'accepted-temporal');

    const broken = run(dir, ['status', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async () => jsonResponse({ error: 'nope' }, 500),
    });
    assert.equal(await broken.promise, 4);
    assert.equal(broken.io.json().ok, false);
    assert.equal(broken.io.json().error.code, 'ACCOUNT_AUTH_FAILED');
  });
});

test('a 401 refreshes the stored token once and does not print either token', async () => {
  await withDir(async (dir) => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'profiles'), { recursive: true });
    const oldToken = jwt({ exp: Math.floor(Date.now() / 1000) + 86_400 });
    const newToken = jwt({ exp: Math.floor(Date.now() / 1000) + 86_400, sub: 'next' });
    const file = join(dir, 'profiles', 'default.json');
    await writeFile(file, `${JSON.stringify({ accessToken: oldToken, refreshToken: REFRESH })}\n`, { mode: 0o600 });
    let meCalls = 0;
    let refreshed = false;
    const status = run(dir, ['status', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/oauth/token')) {
          const body = JSON.parse(init.body);
          assert.equal(body.grant_type, 'refresh_token');
          assert.equal(typeof body.refresh_token, 'string');
          refreshed = true;
          return jsonResponse({ access_token: newToken, refresh_token: 'rotated-refresh-token' });
        }
        if (target.endsWith('/GetMe')) {
          meCalls += 1;
          if (!refreshed) return jsonResponse({ code: 'unauthenticated' }, 401);
          assert.equal(init.headers.authorization, `Bearer ${newToken}`);
          return jsonResponse({ authId: 'user', email: EMAIL });
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await status.promise, 0);
    assert.equal(meCalls, 2);
    assert.equal(status.io.json().loggedIn, true);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored.accessToken, newToken);
    assert.equal(stored.refreshToken, 'rotated-refresh-token');
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
    const printed = `${status.io.text()}\n${status.io.err.join('')}`;
    assert.equal(printed.includes(oldToken), false);
    assert.equal(printed.includes(newToken), false);
    assert.equal(printed.includes(REFRESH), false);
    assert.equal(printed.includes('rotated-refresh-token'), false);
  });
});

test('watch --json writes one event object per line', async () => {
  await withDir(async (dir) => {
    const watched = run(dir, ['watch', '--bot', 'bot-alpha', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: ACCESS },
      fetchImpl: async (url) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return jsonResponse({ agents: [{ agentId: 'bot-alpha', name: 'Alpha' }], truncated: false });
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [{ seq: '1', updatedSeq: '1' }] });
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          return frameResponse([
            framed({ connected: { serverTimeMs: '9', absoluteLifetimeMs: '10' } }),
            textFrame('streamed', '2', 'm-1'),
            framed({}, 2),
          ]);
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await watched.promise, 0);
    const lines = watched.io.text().trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines[0].ok, true);
    assert.equal(lines[0].event.type, 'connected');
    assert.equal(lines[1].event.type, 'message');
    assert.equal(lines[1].event.data.text, 'streamed');
    assert.equal(watched.io.text().includes(ACCESS), false);
  });
});
