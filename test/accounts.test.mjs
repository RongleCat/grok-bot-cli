import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.mjs';
import { findReplyAfterMessage } from '../src/reply.mjs';

const NOW = 1_700_000_000_000;
const NOW_ISO = '2023-11-14T22:13:20.000Z';
const EMAIL = 'hidden@example.com';
const MASKED = 'hi***@example.com';
const AUTH = 'person-auth-id';

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
  const dir = await mkdtemp(join(tmpdir(), 'grok-bot-accounts-'));
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

function idleStatus(agentId = 'bot-alpha') {
  return jsonResponse({
    statuses: [{ agentId, isRunning: false, live: { agentId, sessionId: '', isRunning: false, isComposingMessage: false, isRetrying: false, hasRunningSubagents: false } }],
  });
}

function frameResponse(frames) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  }), { headers: { 'content-type': 'application/connect+json' } });
}

function textFrame(agentId, text, seq, entryId) {
  return framed({
    rows: {
      agentId,
      sessionId: '',
      generation: 1,
      entries: [{
        seq,
        updatedSeq: seq,
        entryId,
        entryKind: 'send-message',
        body: Buffer.from(JSON.stringify({
          id: entryId,
          kind: 'send-message',
          message: { type: 'text', content: text },
        })).toString('base64'),
      }],
    },
  });
}

function hang(init) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(framed({ connected: { serverTimeMs: '1' } }));
      const stop = () => {
        try { controller.error(init?.signal?.reason ?? new DOMException('aborted', 'AbortError')); } catch { /* already closed */ }
      };
      if (init?.signal?.aborted) stop();
      else init?.signal?.addEventListener('abort', stop, { once: true });
    },
  }), { headers: { 'content-type': 'application/connect+json' } });
}

function replyStream(agentId, text) {
  return frameResponse([
    framed({ connected: { serverTimeMs: '1' } }),
    textFrame(agentId, text, '4', `reply-${agentId}`),
    framed({}, 2),
  ]);
}

function encodeBody(body) {
  return Buffer.from(JSON.stringify(body)).toString('base64');
}

function transcriptEntry(seq, entryId, entryKind, body) {
  return { seq: String(seq), updatedSeq: String(seq), entryId, entryKind, body: encodeBody(body) };
}

function hashOf(authId) {
  return createHash('sha256').update(`authId:${authId}`).digest('hex');
}

function bearer(init) {
  return init?.headers?.authorization ?? '';
}

function watchAgent(init) {
  const raw = Buffer.from(init.body);
  return JSON.parse(raw.subarray(5).toString()).cursors[0].agentId;
}

function run(dir, argv, extras = {}) {
  const io = capture();
  const calls = [];
  const fetchImpl = extras.fetchImpl ?? (async (url) => {
    calls.push(String(url));
    throw new Error(`unexpected fetch ${url}`);
  });
  let clock = NOW;
  const promise = runCli({
    argv,
    env: { GROK_BOT_CONFIG_DIR: dir, ...extras.env },
    stdout: io.stdout,
    stderr: io.stderr,
    fetchImpl,
    now: extras.now ?? (() => clock),
    sleep: async () => {},
    openBrowser: async () => {},
    platform: 'darwin',
    homedir: dir,
  });
  return { io, calls, promise, bump(ms) { clock += ms; } };
}

function assertClean(io, secrets) {
  const printed = `${io.text()}\n${io.err.join('')}`;
  for (const secret of secrets) assert.equal(printed.includes(secret), false);
}

async function writeCred(dir, alias, accessToken, extra = {}) {
  const profile = join(dir, 'profiles');
  await mkdir(profile, { recursive: true });
  const file = join(profile, `${alias}.json`);
  const body = `${JSON.stringify({ accessToken, ...extra })}\n`;
  await writeFile(file, body, { mode: 0o600 });
  return { file, body };
}

async function writePending(dir, alias) {
  const profile = join(dir, 'profiles');
  await mkdir(profile, { recursive: true });
  const file = join(profile, `${alias}.pending.json`);
  await writeFile(file, `${JSON.stringify({
    uuid: `uuid-${alias}`,
    verifier: `verifier-${alias}`,
    loginUrl: 'https://cursor.com/loginDeepControl?test=1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    profile: alias,
  })}\n`, { mode: 0o600 });
  return file;
}

function agent(id, name) {
  return { agentId: id, name, title: name, role: 'main', kind: 'bot', viewerSessionId: `sess-${id}` };
}

function roster(...bots) {
  return jsonResponse({ agents: bots, truncated: false });
}

test('migration registers profile files without reading or rewriting credentials', async () => {
  await withDir(async (dir) => {
    const saved = await writeCred(dir, 'default', 'token-default');
    const work = await writeCred(dir, 'work', 'token-work');
    await writePending(dir, 'default');
    await writeFile(join(dir, 'profiles', 'notes.txt'), 'ignore');
    const listed = run(dir, ['accounts', 'list', '--json']);
    assert.equal(await listed.promise, 0);
    assert.equal(listed.calls.length, 0);
    const body = listed.io.json();
    assert.equal(body.default, 'default');
    assert.deepEqual(body.accounts.map(row => row.alias), ['default', 'work']);
    assert.equal(body.accounts[0].default, true);
    assert.equal(body.accounts[1].default, false);
    assert.equal(body.accounts[0].credentials, true);
    assert.equal(body.accounts[0].source, 'file');
    assert.equal(body.accounts[0].label, '');
    const registry = JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8'));
    assert.equal(registry.version, 1);
    assert.equal(registry.default, 'default');
    assert.equal(registry.accounts[0].addedAt, NOW_ISO);
    assert.equal(JSON.stringify(registry).includes('token-default'), false);
    assert.equal(JSON.stringify(registry).includes('identityHash'), false);
    assert.equal((await stat(join(dir, 'accounts.json'))).mode & 0o777, 0o600);
    assert.equal(await readFile(saved.file, 'utf8'), saved.body);
    assert.equal(await readFile(work.file, 'utf8'), work.body);

    const onlyWork = await mkdtemp(join(tmpdir(), 'grok-bot-accounts-'));
    try {
      await writeCred(onlyWork, 'work', 'token-work');
      const migrated = run(onlyWork, ['accounts', 'list', '--json']);
      assert.equal(await migrated.promise, 0);
      assert.equal(migrated.io.json().default, 'default');
      assert.deepEqual(migrated.io.json().accounts.map(row => row.alias), ['work']);
    } finally {
      await rm(onlyWork, { recursive: true, force: true });
    }
  });
});

test('invalid accounts.json is kept and help does not migrate', async () => {
  await withDir(async (dir) => {
    const saved = await writeCred(dir, 'default', 'token-default');
    const help = run(dir, ['--help']);
    assert.equal(await help.promise, 0);
    await assert.rejects(stat(join(dir, 'accounts.json')), /ENOENT/);
    assert.equal(await readFile(saved.file, 'utf8'), saved.body);

    const raw = '{"version":2,"default":"default","accounts":[]}';
    await writeFile(join(dir, 'accounts.json'), raw, { mode: 0o600 });
    const broken = run(dir, ['accounts', 'list', '--json']);
    assert.equal(await broken.promise, 3);
    assert.equal(broken.io.json().error.code, 'ACCOUNTS_INVALID');
    assert.equal(broken.io.json().error.exitCode, 3);
    assert.equal(await readFile(join(dir, 'accounts.json'), 'utf8'), raw);
    assert.equal(await readFile(saved.file, 'utf8'), saved.body);

    const mismatch = run(dir, ['status', '--account', 'default', '--profile', 'work', '--json']);
    assert.equal(await mismatch.promise, 3);
    assert.equal(mismatch.io.json().error.code, 'USAGE');
    assert.equal(mismatch.io.json().error.exitCode, 3);
    assert.equal(await readFile(join(dir, 'accounts.json'), 'utf8'), raw);
  });
});

test('accounts use, rename, remove, and logout keep the registry rules', async () => {
  await withDir(async (dir) => {
    const saved = await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    await writePending(dir, 'work');
    const use = run(dir, ['accounts', 'use', 'work', '--json']);
    assert.equal(await use.promise, 0);
    assert.equal(use.io.json().default, 'work');

    const renamed = run(dir, ['accounts', 'rename', 'default', 'personal', '--json']);
    assert.equal(await renamed.promise, 0);
    assert.equal(renamed.io.json().account, 'personal');
    await assert.rejects(stat(saved.file), /ENOENT/);
    const moved = JSON.parse(await readFile(join(dir, 'profiles', 'personal.json'), 'utf8'));
    assert.equal(moved.accessToken, 'token-default');
    const clash = run(dir, ['accounts', 'rename', 'personal', 'work', '--json']);
    assert.equal(await clash.promise, 3);
    assert.equal(clash.io.json().error.code, 'ACCOUNT_EXISTS');
    assert.equal(await readFile(join(dir, 'profiles', 'personal.json'), 'utf8'), `${JSON.stringify({ accessToken: 'token-default' })}\n`);

    const removed = run(dir, ['accounts', 'remove', 'work', '--json']);
    assert.equal(await removed.promise, 0);
    await assert.rejects(stat(join(dir, 'profiles', 'work.json')), /ENOENT/);
    await assert.rejects(stat(join(dir, 'profiles', 'work.pending.json')), /ENOENT/);
    const afterRemove = JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8'));
    assert.deepEqual(afterRemove.accounts.map(row => row.alias), ['personal']);
    assert.equal(afterRemove.default, 'personal');

    const loggedOut = run(dir, ['logout', '--account', 'personal', '--json']);
    assert.equal(await loggedOut.promise, 0);
    assert.equal(loggedOut.io.json().removed, true);
    await assert.rejects(stat(join(dir, 'profiles', 'personal.json')), /ENOENT/);
    const kept = JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8'));
    assert.deepEqual(kept.accounts.map(row => row.alias), ['personal']);

    await writeCred(dir, 'side', 'token-side');
    const adopted = run(dir, ['accounts', 'use', 'side', '--json']);
    assert.equal(await adopted.promise, 0);
    assert.equal(adopted.io.json().default, 'side');
    const missing = run(dir, ['accounts', 'use', 'nope', '--json']);
    assert.equal(await missing.promise, 3);
    assert.equal(missing.io.json().error.code, 'ACCOUNT_NOT_FOUND');
  });
});

test('accounts add rejects a duplicate identity and stores a masked label', async () => {
  await withDir(async (dir) => {
    const saved = await writeCred(dir, 'default', jwt({ exp: 4_000_000_000, sub: 'default' }));
    const before = await readFile(saved.file);
    await writePending(dir, 'work');
    const duplicate = run(dir, ['accounts', 'add', 'work', '--wait', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.includes('/auth/poll')) return jsonResponse({ accessToken: 'new-token', refreshToken: 'new-refresh' });
        if (target.endsWith('/GetMe')) {
          const who = bearer(init);
          if (who === 'Bearer new-token' || who.startsWith('Bearer ey')) return jsonResponse({ authId: AUTH, email: EMAIL });
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await duplicate.promise, 3);
    const denied = duplicate.io.json();
    assert.equal(denied.error.code, 'ACCOUNT_ALREADY_ADDED');
    assert.equal(denied.error.exitCode, 3);
    assert.equal(denied.error.alias, 'default');
    assert.equal(denied.error.account, 'default');
    await assert.rejects(stat(join(dir, 'profiles', 'work.json')), /ENOENT/);
    await assert.rejects(stat(join(dir, 'profiles', 'work.pending.json')), /ENOENT/);
    assert.equal(Buffer.compare(before, await readFile(saved.file)), 0);
    const registryText = await readFile(join(dir, 'accounts.json'), 'utf8');
    assert.equal(registryText.includes(AUTH), false);
    assert.equal(registryText.includes(EMAIL), false);
    assert.equal(registryText.includes('new-token'), false);
    const registry = JSON.parse(registryText);
    assert.equal(registry.accounts[0].identityHash, hashOf(AUTH));
    assert.equal(registry.accounts.length, 1);
    assertClean(duplicate.io, [AUTH, EMAIL, 'new-token', 'new-refresh', 'verifier-work']);

    await writePending(dir, 'work');
    const workToken = jwt({ exp: 4_000_000_000, sub: 'work' });
    const added = run(dir, ['accounts', 'add', 'work', '--wait', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.includes('/auth/poll')) return jsonResponse({ accessToken: workToken, refreshToken: 'refresh-work' });
        if (target.endsWith('/GetMe')) {
          if (bearer(init) === `Bearer ${workToken}`) return jsonResponse({ authId: 'other-person', email: EMAIL });
          return jsonResponse({ authId: AUTH, email: EMAIL });
        }
        throw new Error(`unexpected ${target}`);
      },
    });
    assert.equal(await added.promise, 0);
    assert.equal(added.io.json().account, 'work');
    assert.equal(added.io.json().label, MASKED);
    assert.equal(added.io.json().defaultAccount, 'default');
    const listed = JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8'));
    assert.equal(listed.default, 'default');
    assert.equal(listed.accounts.find(row => row.alias === 'work').label, MASKED);
    const listedText = JSON.stringify(listed);
    assert.equal(listedText.includes(EMAIL), false);
    assert.equal(listedText.includes('other-person'), false);
    assertClean(added.io, [EMAIL, 'other-person', AUTH, 'refresh-work', workToken]);
    assert.equal(JSON.parse(await readFile(join(dir, 'profiles', 'work.json'), 'utf8')).refreshToken, 'refresh-work');

    await writePending(dir, 'plain');
    const unlabeled = run(dir, ['accounts', 'add', 'plain', '--wait', '--json'], {
      fetchImpl: async (url) => {
        if (String(url).includes('/auth/poll')) return jsonResponse({ accessToken: 'plain-token', refreshToken: 'plain-refresh' });
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.equal(await unlabeled.promise, 0);
    assert.equal(unlabeled.io.json().label, '');
    assert.match(unlabeled.io.err.join(''), /Could not read an account label/);
    assert.equal(JSON.parse(await readFile(join(dir, 'accounts.json'), 'utf8')).default, 'default');
  });
});

test('bot refs resolve by account prefix and across accounts', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const bots = {
      'Bearer token-default': [agent('bot-alpha', 'Alpha'), agent('bot-twin', 'Twin'), agent('bot-note', 'note:one')],
      'Bearer token-work': [agent('bot-beta', 'Beta'), agent('bot-twin-2', 'Twin')],
    };
    const lists = [];
    const fetchImpl = async (url, init) => {
      const target = String(url);
      if (target.endsWith('/ListGrokBotAgents')) {
        lists.push(bearer(init));
        return roster(...bots[bearer(init)]);
      }
      if (target.endsWith('/ListGrokBotAgentSessions')) {
        return jsonResponse({ sessions: [] });
      }
      throw new Error(`unexpected ${target} ${bearer(init)}`);
    };
    const prefixed = run(dir, ['sessions', '--bot', 'work:Beta', '--json'], { fetchImpl });
    assert.equal(await prefixed.promise, 0);
    assert.equal(prefixed.io.json().account, 'work');
    assert.equal(prefixed.io.json().botId, 'bot-beta');
    assert.deepEqual(lists, ['Bearer token-work']);

    lists.length = 0;
    const unique = run(dir, ['sessions', '--bot', 'Beta', '--json'], { fetchImpl });
    assert.equal(await unique.promise, 0);
    assert.equal(unique.io.json().account, 'work');
    assert.equal(lists.length, 2);

    const colonName = run(dir, ['sessions', '--bot', 'note:one', '--json'], { fetchImpl });
    assert.equal(await colonName.promise, 0);
    assert.equal(colonName.io.json().botId, 'bot-note');
    assert.equal(colonName.io.json().account, 'default');

    const ambiguous = run(dir, ['sessions', '--bot', 'Twin', '--json'], { fetchImpl });
    assert.equal(await ambiguous.promise, 3);
    assert.equal(ambiguous.io.json().error.code, 'AMBIGUOUS_BOT');
    assert.equal(ambiguous.io.json().error.exitCode, 3);
    assert.deepEqual(ambiguous.io.json().error.candidates.map(row => row.account), ['default', 'work']);
    assert.match(ambiguous.io.json().error.message, /default:Twin/);
    assert.match(ambiguous.io.json().error.message, /work:Twin/);

    const scoped = run(dir, ['sessions', '--account', 'default', '--bot', 'Beta', '--json'], { fetchImpl });
    assert.equal(await scoped.promise, 3);
    assert.equal(scoped.io.json().error.code, 'BOT_NOT_FOUND');
    const clash = run(dir, ['sessions', '--account', 'default', '--bot', 'work:Beta', '--json'], { fetchImpl });
    assert.equal(await clash.promise, 3);
    assert.equal(clash.io.json().error.code, 'USAGE');
    const empty = run(dir, ['sessions', '--bot', 'work:', '--json'], { fetchImpl });
    assert.equal(await empty.promise, 3);
    assert.equal(empty.io.json().error.code, 'USAGE');

    const skipped = run(dir, ['sessions', '--bot', 'Alpha', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgentSessions')) return jsonResponse({ sessions: [] });
        if (!target.endsWith('/ListGrokBotAgents')) throw new Error(target);
        if (bearer(init) === 'Bearer token-work') return jsonResponse({ error: 'nope' }, 500);
        return roster(agent('bot-alpha', 'Alpha'));
      },
    });
    assert.equal(await skipped.promise, 0);
    assert.equal(skipped.io.json().account, 'default');
    assert.match(skipped.io.err.join(''), /Skipping account work: RPC_FAILED/);

    const failed = run(dir, ['sessions', '--bot', 'Missing', '--json'], {
      fetchImpl: async (url, init) => {
        if (!String(url).endsWith('/ListGrokBotAgents')) throw new Error(String(url));
        if (bearer(init) === 'Bearer token-work') return jsonResponse({ error: 'nope' }, 500);
        return roster(agent('bot-alpha', 'Alpha'));
      },
    });
    assert.equal(await failed.promise, 3);
    assert.equal(failed.io.json().error.code, 'BOT_NOT_FOUND');
    assert.deepEqual(failed.io.json().error.failedAccounts, [{ account: 'work', code: 'RPC_FAILED' }]);
    assert.equal(failed.io.err.join('').includes('Skipping account'), false);

    lists.length = 0;
    const cached = run(dir, ['relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping', '--dry-run', '--json'], { fetchImpl });
    assert.equal(await cached.promise, 0);
    const perToken = lists.reduce((counts, token) => ({ ...counts, [token]: (counts[token] ?? 0) + 1 }), {});
    assert.equal(perToken['Bearer token-default'], 1);
    assert.equal(perToken['Bearer token-work'], 1);
  });
});

test('an environment token overrides only the selected account', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push(bearer(init));
      if (String(url).endsWith('/ListGrokBotAgents')) {
        if (bearer(init) === 'Bearer env-token') return roster(agent('bot-alpha', 'Alpha'));
        if (bearer(init) === 'Bearer token-work') return roster(agent('bot-beta', 'Beta'));
        throw new Error(`unexpected bearer ${bearer(init)}`);
      }
      if (String(url).endsWith('/ListGrokBotAgentSessions')) return jsonResponse({ sessions: [] });
      throw new Error(String(url));
    };
    const found = run(dir, ['sessions', '--bot', 'Beta', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: 'env-token' },
      fetchImpl,
    });
    assert.equal(await found.promise, 0);
    assert.equal(found.io.json().account, 'work');
    assert.equal(seen.includes('Bearer token-work'), true);
    assert.equal(seen.includes('Bearer token-default'), false);
    assert.equal(seen.includes('Bearer env-token'), true);
  });
});

test('bots --all-accounts keeps partial success and fails only when every account fails', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const partial = run(dir, ['bots', '--all-accounts', '--json'], {
      fetchImpl: async (url, init) => {
        if (!String(url).endsWith('/ListGrokBotAgents')) throw new Error(String(url));
        if (bearer(init) === 'Bearer token-work') return jsonResponse({ error: 'nope' }, 500);
        return roster(agent('bot-alpha', 'Alpha'));
      },
    });
    assert.equal(await partial.promise, 0);
    const body = partial.io.json();
    assert.equal(body.ok, true);
    assert.equal(body.accounts.find(row => row.account === 'default').ok, true);
    assert.equal(body.accounts.find(row => row.account === 'default').count, 1);
    assert.equal(body.accounts.find(row => row.account === 'work').ok, false);
    assert.equal(body.accounts.find(row => row.account === 'work').error.code, 'RPC_FAILED');
    assert.equal(body.accounts.find(row => row.account === 'work').exitCode, undefined);
    assert.deepEqual(body.bots.map(bot => bot.account), ['default']);
    assert.equal(body.bots[0].id, 'bot-alpha');
    assert.equal(body.bots[0].name, 'Alpha');

    const allFailed = run(dir, ['bots', '--all-accounts', '--json'], {
      fetchImpl: async () => jsonResponse({ error: 'nope' }, 500),
    });
    assert.equal(await allFailed.promise, 4);
    assert.equal(allFailed.io.json().ok, false);
    assert.equal(allFailed.io.json().error.code, 'RPC_FAILED');
    assert.equal(allFailed.io.json().error.exitCode, 4);
    assert.equal(allFailed.io.json().accounts.length, 2);

    const emptyDir = await mkdtemp(join(tmpdir(), 'grok-bot-accounts-'));
    try {
      const none = run(emptyDir, ['bots', '--all-accounts', '--json']);
      assert.equal(await none.promise, 0);
      assert.deepEqual(none.io.json().accounts, []);
      assert.deepEqual(none.io.json().bots, []);
      await assert.rejects(stat(join(emptyDir, 'accounts.json')), /ENOENT/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }

    const loggedOut = run(dir, ['logout', '--json']);
    assert.equal(await loggedOut.promise, 0);
    const other = run(dir, ['logout', '--account', 'work', '--json']);
    assert.equal(await other.promise, 0);
    const missing = run(dir, ['bots', '--all-accounts', '--json']);
    assert.equal(await missing.promise, 2);
    assert.equal(missing.io.json().error.code, 'NOT_LOGGED_IN');
    assert.equal(missing.io.json().error.exitCode, 2);
    assert.equal(missing.io.json().accounts.length, 2);
  });
});

test('accounts list --check reports each account and still exits 0', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeFile(join(dir, 'profiles', 'work.json'), '{', { mode: 0o600 });
    const checked = run(dir, ['accounts', 'list', '--check', '--json'], {
      fetchImpl: async (url, init) => {
        if (String(url).endsWith('/GetMe') && bearer(init) === 'Bearer token-default') return jsonResponse({ authId: AUTH, email: EMAIL });
        throw new Error(String(url));
      },
    });
    assert.equal(await checked.promise, 0);
    const rows = checked.io.json().accounts;
    assert.equal(rows.find(row => row.alias === 'default').check.ok, true);
    assert.equal(rows.find(row => row.alias === 'default').label, MASKED);
    assert.equal(rows.find(row => row.alias === 'work').source, 'invalid');
    assert.equal(rows.find(row => row.alias === 'work').check.ok, false);
    assert.equal(rows.find(row => row.alias === 'work').check.code, 'CREDENTIALS_INVALID');
    const stored = await readFile(join(dir, 'accounts.json'), 'utf8');
    assert.equal(stored.includes(EMAIL), false);
    assert.equal(stored.includes(AUTH), false);
    assert.equal(JSON.parse(stored).accounts.find(row => row.alias === 'default').identityHash, hashOf(AUTH));
    assertClean(checked.io, [EMAIL, AUTH]);
  });
});

test('relay sends one round trip, stops on the next failure, and can dry-run', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const sends = [];
    const fetchImpl = async (url, init) => {
      const target = String(url);
      const token = bearer(init);
      if (target.endsWith('/ListGrokBotAgents')) {
        if (token === 'Bearer token-default') return roster(agent('bot-alpha', 'Alpha'));
        if (token === 'Bearer token-work') return roster(agent('bot-beta', 'Beta'));
      }
      if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
      if (target.endsWith('/SendGrokBotUserMessage')) {
        const body = JSON.parse(init.body);
        sends.push({ token, text: body.text, agentId: body.agentId });
        if (body.agentId === 'bot-beta' && sends.filter(row => row.agentId === 'bot-beta').length === 1 && init?.signal?.aborted) {
          return jsonResponse({ error: 'nope' }, 500);
        }
        return jsonResponse({ delivery: 1, dispatched: true });
      }
      if (target.endsWith('/ListGrokBotAgentStatuses')) return idleStatus(JSON.parse(init.body).agentIds?.[0]);
      if (target.endsWith('/WatchGrokBotTranscripts')) {
        const agentId = watchAgent(init);
        const reply = agentId === 'bot-alpha' ? 'raw {reply}' : 'to-says';
        return replyStream(agentId, reply);
      }
      throw new Error(`unexpected ${target}`);
    };
    const relay = run(dir, [
      'relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping',
      '--template', '{fromAccount}:{fromName}:{reply}', '--rounds', '2',
      '--idle-timeout', '0', '--json',
    ], { fetchImpl });
    assert.equal(await relay.promise, 0);
    const steps = relay.io.json().steps;
    assert.equal(steps.length, 4);
    assert.deepEqual(sends.map(row => row.text), [
      'ping',
      'default:Alpha:raw {reply}',
      'work:Beta:to-says',
      'default:Alpha:raw {reply}',
    ]);
    assert.equal(steps[1].sent, true);
    assert.equal(steps[1].text, 'to-says');
    assert.equal(steps[1].account, 'work');
    assert.equal(steps[0].botName, 'Alpha');
    assert.equal(sends.filter(row => row.agentId === 'bot-alpha').length, 2);
    assert.equal(sends.filter(row => row.agentId === 'bot-beta').length, 2);

    sends.length = 0;
    const failed = run(dir, ['relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping', '--idle-timeout', '0', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        const token = bearer(init);
        if (target.endsWith('/ListGrokBotAgents')) {
          if (token === 'Bearer token-default') return roster(agent('bot-alpha', 'Alpha'));
          return roster(agent('bot-beta', 'Beta'));
        }
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/SendGrokBotUserMessage')) {
          const body = JSON.parse(init.body);
          sends.push(body.agentId);
          if (body.agentId === 'bot-beta') return jsonResponse({ error: 'nope' }, 500);
          return jsonResponse({ delivery: 1, dispatched: true });
        }
        if (target.endsWith('/ListGrokBotAgentStatuses')) return idleStatus(JSON.parse(init.body).agentIds?.[0]);
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          const agentId = watchAgent(init);
          if (agentId === 'bot-beta') return hang(init);
          return replyStream(agentId, 'from-alpha');
        }
        throw new Error(target);
      },
    });
    assert.equal(await failed.promise, 4);
    const error = failed.io.json().error;
    assert.equal(error.code, 'SEND_UNCONFIRMED');
    assert.equal(error.exitCode, 4);
    assert.equal(error.sent, false);
    assert.equal(error.completedSteps.length, 1);
    assert.equal(error.completedSteps[0].text, 'from-alpha');
    assert.equal(error.completedSteps[0].sent, true);
    assert.deepEqual(sends, ['bot-alpha', 'bot-beta']);

    const urls = [];
    const dry = run(dir, ['relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping', '--dry-run', '--json'], {
      fetchImpl: async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith('/ListGrokBotAgents')) {
          if (bearer(init) === 'Bearer token-default') return roster(agent('bot-alpha', 'Alpha'));
          return roster(agent('bot-beta', 'Beta'));
        }
        throw new Error(String(url));
      },
    });
    assert.equal(await dry.promise, 0);
    assert.equal(dry.io.json().dryRun, true);
    assert.equal(dry.io.json().text, 'ping');
    assert.equal(dry.io.json().template, '{reply}');
    assert.equal(dry.io.json().from.botId, 'bot-alpha');
    assert.equal(dry.io.json().to.account, 'work');
    assert.equal(urls.some(url => url.includes('SendGrokBotUserMessage')), false);

    const tooMany = run(dir, ['relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping', '--rounds', '11', '--json']);
    assert.equal(await tooMany.promise, 3);
    assert.equal(tooMany.calls.length, 0);
    assert.match(tooMany.io.json().error.message, /--rounds must be an integer from 1 to 10/);
    const zero = run(dir, ['relay', '--from', 'Alpha', '--to', 'Beta', '--text', 'ping', '--rounds', '0', '--json']);
    assert.equal(await zero.promise, 3);
    assert.equal(zero.calls.length, 0);
    assert.equal(zero.io.json().error.exitCode, 3);
  });
});

test('wait reads a finished reply from the transcript and send timeout keeps the message id', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    const urls = [];
    const ready = run(dir, ['wait', '--bot', 'Alpha', '--message-id', 'msg-123', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        urls.push(target);
        if (target.endsWith('/ListGrokBotAgents')) return roster(agent('bot-alpha', 'Alpha'));
        if (target.endsWith('/GetGrokBotSendStatus')) return jsonResponse({ echoEntryId: 'entry-anchor' });
        if (target.endsWith('/ListGrokBotTranscriptEntries')) {
          const body = JSON.parse(init.body);
          assert.equal(body.limit, 500);
          return jsonResponse({
            generation: 1,
            entries: [
              transcriptEntry(1, 'entry-anchor', 'send-message', { kind: 'send-message', content: 'question' }),
              transcriptEntry(2, 'entry-reply', 'message', { kind: 'message', role: 'assistant', content: 'already there' }),
            ],
          });
        }
        throw new Error(target);
      },
    });
    assert.equal(await ready.promise, 0);
    assert.equal(ready.io.json().endedBy, 'transcript');
    assert.equal(ready.io.json().text, 'already there');
    assert.equal(ready.io.json().account, 'default');
    assert.equal(urls.some(url => url.endsWith('/WatchGrokBotTranscripts')), false);

    const watched = run(dir, ['wait', '--bot', 'Alpha', '--message-id', 'msg-123', '--idle-timeout', '0', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        urls.push(target);
        if (target.endsWith('/ListGrokBotAgents')) return roster(agent('bot-alpha', 'Alpha'));
        if (target.endsWith('/GetGrokBotSendStatus')) return jsonResponse({});
        if (target.endsWith('/ListGrokBotTranscriptEntries')) {
          const body = JSON.parse(init.body);
          if (body.limit === 500) {
            return jsonResponse({
              generation: 1,
              entries: [transcriptEntry(1, 'entry-anchor', 'send-message', { id: 'msg-123', kind: 'send-message', content: 'question' })],
            });
          }
          return jsonResponse({ generation: 1, entries: [] });
        }
        if (target.endsWith('/ListGrokBotAgentStatuses')) return idleStatus('bot-alpha');
        if (target.endsWith('/WatchGrokBotTranscripts')) return replyStream('bot-alpha', 'from the watch');
        if (target.endsWith('/SendGrokBotUserMessage')) throw new Error('wait must not send');
        throw new Error(target);
      },
    });
    assert.equal(await watched.promise, 0);
    assert.equal(watched.io.json().text, 'from the watch');
    assert.equal(watched.io.json().endedBy, 'status-idle');

    let sentId = '';
    let now = NOW;
    const timed = run(dir, ['send', '--bot', 'bot-alpha', '--text', 'hello', '--wait', '--timeout', '5', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: 'env-token' },
      now: () => now,
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) return roster(agent('bot-alpha', 'Alpha'));
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/SendGrokBotUserMessage')) {
          sentId = JSON.parse(init.body).messageId;
          now += 6_000;
          return jsonResponse({ delivery: 1, dispatched: true });
        }
        if (target.endsWith('/WatchGrokBotTranscripts')) return hang(init);
        throw new Error(target);
      },
    });
    assert.equal(await timed.promise, 5);
    assert.equal(timed.io.json().error.code, 'TIMEOUT');
    assert.equal(timed.io.json().error.exitCode, 5);
    assert.equal(timed.io.json().error.sent, true);
    assert.equal(timed.io.json().error.messageId, sentId);
    assert.match(timed.io.json().error.message, new RegExp(`wait --bot default:bot-alpha --message-id ${sentId}`));

    const missing = run(dir, ['send', '--bot', 'missing', '--text', 'hello', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: 'env-token' },
      fetchImpl: async (url) => {
        if (String(url).endsWith('/ListGrokBotAgents')) return roster(agent('bot-alpha', 'Alpha'));
        throw new Error(String(url));
      },
    });
    assert.equal(await missing.promise, 3);
    assert.equal(missing.io.json().error.code, 'BOT_NOT_FOUND');
    assert.equal(missing.io.json().error.sent, false);
    assert.equal(missing.io.json().error.exitCode, 3);

    const empty = await mkdtemp(join(tmpdir(), 'grok-bot-accounts-'));
    try {
      const loggedOut = run(empty, ['status', '--json']);
      assert.equal(await loggedOut.promise, 2);
      assert.equal(loggedOut.io.json().error.exitCode, 2);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

test('findReplyAfterMessage treats send-message as a bot reply and stops at role=user', () => {
  const streaming = findReplyAfterMessage([
    { seq: '1', entryId: 'echo-entry', body: { kind: 'message', role: 'user', content: 'ask' } },
    { seq: '2', body: { kind: 'message', role: 'assistant', content: 'still', isStreaming: true } },
  ], 'other-id', { echoEntryId: 'echo-entry' });
  assert.equal(streaming.foundAnchor, true);
  assert.equal(streaming.complete, false);

  const reply = findReplyAfterMessage([
    { seq: '1', entryId: 'u', body: { id: 'msg-9', kind: 'message', role: 'user', content: 'ask' } },
    { seq: '2', entryId: 'a', body: { kind: 'message', role: 'assistant', content: 'first' } },
    { seq: '3', entryId: 'b', entryKind: 'send-message', body: { kind: 'send-message', message: { type: 'text', content: 'from the tool' } } },
    { seq: '4', entryId: 'c', body: { kind: 'message', role: 'user', content: 'next' } },
    { seq: '5', entryId: 'd', body: { kind: 'message', role: 'assistant', content: 'ignored' } },
  ], 'msg-9');
  assert.equal(reply.complete, true);
  assert.equal(reply.text, 'first\n\nfrom the tool');
  assert.equal(findReplyAfterMessage([], 'missing').foundAnchor, false);

  const onlyTool = findReplyAfterMessage([
    { seq: '1', entryId: 'user-1', body: { id: 'msg-1', kind: 'message', role: 'user', content: '请用一句话介绍你自己的职责' } },
    { seq: '2', entryId: 'bot-1', entryKind: 'send-message', body: { kind: 'send-message', message: { type: 'text', content: '我是 Webhook 测试员' } } },
  ], 'msg-1');
  assert.equal(onlyTool.complete, true);
  assert.equal(onlyTool.text, '我是 Webhook 测试员');
});

test('watch merges bots from more than one account', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const watched = run(dir, ['watch', '--bot', 'Alpha', '--bot', 'work:Beta', '--json'], {
      fetchImpl: async (url, init) => {
        const target = String(url);
        if (target.endsWith('/ListGrokBotAgents')) {
          if (bearer(init) === 'Bearer token-default') return roster(agent('bot-alpha', 'Alpha'));
          return roster(agent('bot-beta', 'Beta'));
        }
        if (target.endsWith('/ListGrokBotTranscriptEntries')) return jsonResponse({ generation: 1, entries: [] });
        if (target.endsWith('/WatchGrokBotTranscripts')) {
          const agentId = watchAgent(init);
          return frameResponse([
            framed({ connected: { serverTimeMs: '1' } }),
            textFrame(agentId, `hello-${agentId}`, '1', `m-${agentId}`),
            framed({}, 2),
          ]);
        }
        throw new Error(target);
      },
    });
    assert.equal(await watched.promise, 0);
    const lines = watched.io.text().trim().split('\n').map(line => JSON.parse(line));
    const messages = lines.filter(line => line.event?.type === 'message');
    assert.equal(messages.length, 2);
    const alpha = messages.find(line => line.botId === 'bot-alpha');
    const beta = messages.find(line => line.botId === 'bot-beta');
    assert.equal(alpha.account, 'default');
    assert.equal(alpha.event.type, 'message');
    assert.equal(alpha.event.data.text, 'hello-bot-alpha');
    assert.equal(beta.account, 'work');
    assert.equal(beta.event.data.text, 'hello-bot-beta');
  });
});
