import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli.mjs';
import { findReplyAfterMessage } from '../src/reply.mjs';
import { createTurnWait } from '../src/wait.mjs';

const TOKEN = 'token-default';
const WRITES = new Set([
  'DeleteGrokBotAgent',
  'CreateGrokBotAgent',
  'UpdateGrokBotAgent',
  'DuplicateGrokBotAgent',
  'CreateGrokBotRoom',
  'AddGrokBotRoomPeople',
  'RemoveGrokBotRoomPeople',
  'SetGrokBotRoomMembers',
  'AddGrokBotAgentSkill',
  'UpdateGrokBotAgentSkill',
  'RemoveGrokBotAgentSkill',
]);

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
  const dir = await mkdtemp(join(tmpdir(), 'grok-bot-manage-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function rpcBody(init) {
  return JSON.parse(init.body);
}

function methodOf(url) {
  return String(url).split('/').pop();
}

function agent(id, name, extra = {}) {
  return {
    agentId: id,
    id: `server-${id}`,
    name,
    title: name,
    role: 'main',
    kind: 'GROK_BOT_AGENT_KIND_AGENT',
    viewerSessionId: `sess-${id}`,
    ...extra,
  };
}

function room(id, name, extra = {}) {
  return agent(id, name, { kind: 'ROOM', ...extra });
}

function roster(...bots) {
  return jsonResponse({ agents: bots, truncated: false });
}

function createdAgent(body, extra = {}) {
  return {
    agentId: body.agentId,
    id: extra.id ?? 'server-created',
    name: extra.name ?? body.name ?? 'created',
    title: body.title ?? '',
    description: body.description ?? '',
    role: 'main',
    kind: extra.kind ?? 'GROK_BOT_AGENT_KIND_AGENT',
    viewerSessionId: 'sess-created',
  };
}

function skillResult(name, content) {
  return jsonResponse({
    marketplace: { marketplaceId: '1', displayName: 'local', description: '' },
    plugins: [],
    skill: { name, description: 'd', sourcePath: `${name}/SKILL.md`, content },
  });
}

function encodeBody(body) {
  return Buffer.from(JSON.stringify(body)).toString('base64');
}

function transcriptEntry(seq, entryId, entryKind, body) {
  return { seq: String(seq), updatedSeq: String(seq), entryId, entryKind, body: encodeBody(body) };
}

async function writeCred(dir, alias, accessToken) {
  const profile = join(dir, 'profiles');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, `${alias}.json`), `${JSON.stringify({ accessToken })}\n`, { mode: 0o600 });
}

function run(dir, argv, extras = {}) {
  const io = capture();
  const calls = [];
  const fetchImpl = extras.fetchImpl ?? (async (url) => {
    calls.push(methodOf(url));
    throw new Error(`unexpected ${url}`);
  });
  const promise = runCli({
    argv,
    env: { GROK_BOT_CONFIG_DIR: dir, GROK_BOT_ACCESS_TOKEN: TOKEN, ...extras.env },
    stdout: io.stdout,
    stderr: io.stderr,
    fetchImpl,
    now: () => 1_700_000_000_000,
    sleep: async () => {},
    openBrowser: async () => {},
    platform: 'darwin',
    homedir: dir,
  });
  return { io, calls, promise };
}

function assertNoWrites(calls) {
  for (const name of calls) assert.equal(WRITES.has(name), false, name);
}

const ALPHA = agent('bot-alpha', 'Alpha');
const ALPINE = agent('bot-alpine', 'Alpine');
const BETA = agent('bot-beta', 'Beta');
const ROOM = room('room-1', 'Room One');
const ROOM_KIND_2 = room('room-2', 'Kind Two', { kind: '2' });
const ROOM_LONG = room('room-3', 'Kind Long', { kind: 'GROK_BOT_AGENT_KIND_ROOM' });

test('management commands reject missing and conflicting flags before any request', async () => {
  await withDir(async (dir) => {
    const cases = [
      [['files', '--json'], /files requires --bot/],
      [['invites', '--json'], /invites requires --bot/],
      [['bot', '--json'], /bot requires create, update, duplicate, or delete/],
      [['bot', 'nope', '--json'], /Unknown bot command "nope"/],
      [['bot', 'create', '--json'], /bot create requires --name/],
      [['bot', 'create', '--name', '   ', '--json'], /--name must not be empty/],
      [['bot', 'update', '--bot', 'Alpha', '--json'], /bot update requires --name, --description, or --title/],
      [['bot', 'duplicate', '--json'], /bot duplicate requires --bot/],
      [['bot', 'delete', '--json'], /bot delete requires --bot/],
      [['bot', 'delete', '--bot', 'Alpha', '--dry-run', '--json'], /--dry-run is not valid for bot delete/],
      [['files', '--bot', 'Alpha', '--yes', '--json'], /--yes is not valid for files/],
      [['room', '--json'], /room requires create/],
      [['room', 'create', '--name', 'R', '--json'], /room create requires --member/],
      [['room', 'add-member', '--room', 'R', '--json'], /room add-member requires --user-id/],
      [['room', 'add-member', '--room', 'R', '--user-id', '0', '--json'], /--user-id must be a positive number/],
      [['room', 'add-member', '--room', 'R', '--user-id', '1.5', '--json'], /--user-id must be an integer/],
      [['room', 'add-member', '--room', 'R', '--user-id', '2147483648', '--json'], /1 to 2147483647/],
      [['room', 'delete', '--json'], /room delete requires --room/],
      [['room', 'remove-member', '--room', 'R', '--json'], /room remove-member requires --user-id/],
      [['room', 'set-members', '--room', 'R', '--json'], /room set-members requires --member/],
      [['room', 'delete', '--room', 'R', '--room', 'S', '--json'], /--room can be set only once/],
      [['skill', 'add', '--bot', 'Alpha', '--name', 'demo', '--json'], /skill add requires --content or --content-file/],
      [['skill', 'add', '--bot', 'Alpha', '--name', 'demo', '--content', 'c', '--content-file', 'f', '--json'], /either --content or --content-file/],
      [['skill', 'update', '--bot', 'Alpha', '--content', 'c', '--json'], /skill update requires --name/],
      [['skill', 'remove', '--bot', 'Alpha', '--json'], /skill remove requires --name/],
      [['skill', 'remove', '--name', 'demo', '--json'], /skill remove requires --bot/],
      [['skill', 'nope', '--json'], /Unknown skill command "nope"/],
    ];
    for (const [argv, pattern] of cases) {
      const result = run(dir, argv);
      assert.equal(await result.promise, 3, argv.join(' '));
      const error = result.io.json().error;
      assert.equal(error.code, 'USAGE', argv.join(' '));
      assert.equal(error.exitCode, 3);
      assert.match(error.message, pattern, argv.join(' '));
      assert.equal(result.calls.length, 0, argv.join(' '));
    }
  });
});

test('files and invites read with bot id, account prefix, and optional page token', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', TOKEN);
    const calls = [];
    const fetchImpl = async (url, init) => {
      const name = methodOf(url);
      calls.push(name);
      assert.equal(init.headers['x-cursor-client-version'], '0.78.1');
      assert.equal(init.headers.authorization, `Bearer ${TOKEN}`);
      if (name === 'ListGrokBotAgents') return roster(ALPHA, ALPINE);
      if (name === 'ListGrokBotAgentFiles') {
        const body = rpcBody(init);
        assert.equal(body.agentId, 'bot-alpine');
        assert.equal(Object.hasOwn(body, 'pageToken'), false);
        return jsonResponse({
          files: [{ name: 'a.txt', path: 'notes/a.txt', sizeBytes: '3', contentType: 'text/plain', updatedAtMs: '1', etag: 'e' }],
          nextPageToken: '',
          totalBytes: '3',
          canEdit: false,
        });
      }
      if (name === 'ListGrokBotAgentAccessInvites') {
        const body = rpcBody(init);
        assert.equal(body.agentId, 'bot-alpha');
        return jsonResponse({
          invites: [{ email: 'person@example.com', expiresAtMs: '9' }],
          capUsage: { used: 1, limit: 5 },
        });
      }
      throw new Error(name);
    };
    const listed = run(dir, ['files', '--bot', 'Alpi', '--json'], { fetchImpl });
    assert.equal(await listed.promise, 0);
    assert.equal(listed.io.json().botId, 'bot-alpine');
    assert.equal(listed.io.json().count, 1);
    assert.equal(listed.io.json().totalBytes, '3');
    assert.equal(listed.io.json().canEdit, false);
    assert.equal(listed.io.json().files[0].path, 'notes/a.txt');

    const paged = run(dir, ['files', '--bot', 'default:Alpha', '--page-token', 'next', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push(name);
        if (name === 'ListGrokBotAgents') return roster(ALPHA);
        if (name === 'ListGrokBotAgentFiles') {
          assert.equal(rpcBody(init).pageToken, 'next');
          assert.equal(rpcBody(init).agentId, 'bot-alpha');
          return jsonResponse({ files: [], nextPageToken: 'more', totalBytes: '0', canEdit: true });
        }
        throw new Error(name);
      },
    });
    assert.equal(await paged.promise, 0);
    assert.equal(paged.io.json().account, 'default');
    assert.equal(paged.io.json().nextPageToken, 'more');
    assert.equal(paged.io.json().count, 0);

    const invites = run(dir, ['invites', '--bot', 'Alpha', '--json'], { fetchImpl });
    assert.equal(await invites.promise, 0);
    assert.equal(invites.io.json().count, 1);
    assert.deepEqual(invites.io.json().capUsage, { used: 1, limit: 5 });
    assertNoWrites(calls);
  });
});

test('bot create, update, and duplicate send serverId or Bot.id to the matching RPC', async () => {
  await withDir(async (dir) => {
    const calls = [];
    const seen = {};
    const fetchImpl = async (url, init) => {
      const name = methodOf(url);
      calls.push(name);
      if (name === 'ListGrokBotAgents') return roster(ALPHA, ALPINE);
      if (name === 'CreateGrokBotAgent') {
        seen.create = rpcBody(init);
        return jsonResponse({ agent: createdAgent(seen.create, { name: seen.create.name }), harness: 'TEMPORAL' });
      }
      if (name === 'UpdateGrokBotAgent') {
        seen.update = rpcBody(init);
        return jsonResponse({
          agent: agent('bot-alpha', seen.update.name, { id: seen.update.id, description: seen.update.description, title: seen.update.title }),
        });
      }
      if (name === 'DuplicateGrokBotAgent') {
        seen.duplicate = rpcBody(init);
        return jsonResponse({
          agent: agent(seen.duplicate.agentId, 'Alpha copy', { id: 'server-copy' }),
        });
      }
      throw new Error(name);
    };
    const created = run(dir, ['bot', 'create', '--name', 'New', '--description', 'desc', '--title', 'title', '--json'], { fetchImpl });
    assert.equal(await created.promise, 0);
    assert.equal(seen.create.name, 'New');
    assert.equal(seen.create.description, 'desc');
    assert.equal(seen.create.title, 'title');
    assert.equal(created.io.json().harness, 'temporal');
    assert.equal(created.io.json().bot.name, 'New');
    assert.equal(created.io.json().account, 'default');

    const updated = run(dir, ['bot', 'update', '--bot', 'Alpha', '--name', 'Renamed', '--description', 'next', '--json'], { fetchImpl });
    assert.equal(await updated.promise, 0);
    assert.equal(seen.update.id, 'server-bot-alpha');
    assert.notEqual(seen.update.id, 'bot-alpha');
    assert.equal(seen.update.partialUpdate, true);
    assert.equal(seen.update.name, 'Renamed');
    assert.equal(seen.update.description, 'next');
    assert.equal(Object.hasOwn(seen.update, 'title'), false);
    assert.equal(updated.io.json().serverId, 'server-bot-alpha');
    assert.equal(updated.io.json().botId, 'bot-alpha');

    calls.length = 0;
    const missingServer = run(dir, ['bot', 'update', '--bot', 'Alpha', '--title', 'T', '--json'], {
      fetchImpl: async (url) => {
        calls.push(methodOf(url));
        if (methodOf(url) === 'ListGrokBotAgents') return roster(agent('bot-alpha', 'Alpha', { id: null }));
        throw new Error(methodOf(url));
      },
    });
    assert.equal(await missingServer.promise, 3);
    assert.equal(missingServer.io.json().error.code, 'USAGE');
    assert.match(missingServer.io.json().error.message, /no server id/);
    assert.deepEqual(calls, ['ListGrokBotAgents']);

    const copied = run(dir, ['bot', 'duplicate', '--bot', 'bot-alpha', '--name', 'Copy Name', '--json'], { fetchImpl });
    assert.equal(await copied.promise, 0);
    assert.equal(seen.duplicate.sourceAgentId, 'bot-alpha');
    assert.notEqual(seen.duplicate.sourceAgentId, 'server-bot-alpha');
    assert.equal(seen.update.id, 'server-copy');
    assert.equal(seen.update.name, 'Copy Name');
    assert.equal(copied.io.json().renamed, true);
    assert.equal(copied.io.json().sourceBotId, 'bot-alpha');
    assert.equal(copied.io.json().bot.serverId, 'server-copy');
    assert.equal(copied.io.json().bot.name, 'Copy Name');

    const plain = run(dir, ['bot', 'duplicate', '--bot', 'Alpha', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push(name);
        if (name === 'ListGrokBotAgents') return roster(ALPHA);
        if (name === 'DuplicateGrokBotAgent') {
          const body = rpcBody(init);
          assert.equal(body.sourceAgentId, 'bot-alpha');
          return jsonResponse({ agent: agent(body.agentId, 'Alpha copy', { id: 'server-plain' }) });
        }
        throw new Error(name);
      },
    });
    assert.equal(await plain.promise, 0);
    assert.equal(plain.io.json().renamed, false);
    assert.equal(plain.io.json().bot.name, 'Alpha copy');

    let renames = 0;
    const nameless = run(dir, ['bot', 'duplicate', '--bot', 'Alpha', '--name', 'Needs Server', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        if (name === 'UpdateGrokBotAgent') renames += 1;
        if (name === 'ListGrokBotAgents') return roster(ALPHA);
        if (name === 'DuplicateGrokBotAgent') {
          const body = rpcBody(init);
          return jsonResponse({
            agent: { agentId: body.agentId, name: 'Alpha copy', kind: 'GROK_BOT_AGENT_KIND_AGENT', role: 'main' },
          });
        }
        throw new Error(name);
      },
    });
    assert.equal(await nameless.promise, 3);
    assert.equal(nameless.io.json().error.duplicated, true);
    assert.match(nameless.io.json().error.message, /was copied/);
    assert.equal(renames, 0);
  });
});

test('destructive commands dry-run unless --yes, and a fragment cannot delete', async () => {
  await withDir(async (dir) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const name = methodOf(url);
      calls.push(name);
      if (name === 'ListGrokBotAgents') return roster(ALPHA, ALPINE, BETA, ROOM, ROOM_KIND_2, ROOM_LONG, agent('alp', 'Other'));
      if (name === 'DeleteGrokBotAgent') {
        return jsonResponse({});
      }
      if (name === 'RemoveGrokBotRoomPeople') return jsonResponse({});
      if (name === 'SetGrokBotRoomMembers') {
        const body = rpcBody(init);
        return jsonResponse({ agent: room(body.agentId, 'Room One', { id: 'server-room-1' }) });
      }
      if (name === 'RemoveGrokBotAgentSkill') return skillResult('demo', '');
      throw new Error(name);
    };
    const preview = run(dir, ['bot', 'delete', '--bot', 'Webhook 测试员', '--json'], {
      fetchImpl: async (url) => {
        calls.push(methodOf(url));
        if (methodOf(url) === 'ListGrokBotAgents') return roster(agent('bot-hook', 'Webhook 测试员'));
        throw new Error(methodOf(url));
      },
    });
    assert.equal(await preview.promise, 0);
    assert.equal(preview.io.json().dryRun, true);
    assert.equal(preview.io.json().action, 'bot delete');
    assert.equal(preview.io.json().botId, 'bot-hook');
    assert.equal(preview.io.json().botName, 'Webhook 测试员');
    assert.equal(preview.io.json().account, 'default');
    assertNoWrites(calls);

    calls.length = 0;
    const fragment = run(dir, ['bot', 'delete', '--bot', 'Alpi', '--yes', '--json'], { fetchImpl });
    assert.equal(await fragment.promise, 3);
    assert.equal(fragment.io.json().error.code, 'AMBIGUOUS_BOT');
    assert.equal(fragment.io.json().error.candidates.length, 1);
    assert.equal(fragment.io.json().error.candidates[0].id, 'bot-alpine');
    assert.match(fragment.io.json().error.message, /full name/);
    assert.equal(calls.includes('DeleteGrokBotAgent'), false);

    calls.length = 0;
    const removed = run(dir, ['bot', 'delete', '--bot', 'alpine', '--yes', '--json'], { fetchImpl });
    assert.equal(await removed.promise, 0);
    assert.equal(removed.io.json().deleted, true);
    assert.equal(removed.io.json().botId, 'bot-alpine');
    assert.equal(removed.io.json().id, 'bot-alpine');
    const deleteBody = calls.filter(name => name === 'DeleteGrokBotAgent');
    assert.equal(deleteBody.length, 1);

    const byId = run(dir, ['bot', 'delete', '--bot', 'alp', '--yes', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push({ name, body: init?.body ? rpcBody(init) : null });
        if (name === 'ListGrokBotAgents') return roster(agent('alp', 'Other'), ALPINE);
        if (name === 'DeleteGrokBotAgent') return jsonResponse({});
        throw new Error(name);
      },
    });
    assert.equal(await byId.promise, 0);
    const deleted = calls.find(row => row.name === 'DeleteGrokBotAgent');
    assert.equal(deleted.body.id, 'alp');

    calls.length = 0;
    const notRoom = run(dir, ['room', 'delete', '--room', 'Alpha', '--yes', '--json'], { fetchImpl });
    assert.equal(await notRoom.promise, 3);
    assert.equal(notRoom.io.json().error.code, 'NOT_A_ROOM');
    assert.equal(notRoom.io.json().error.exitCode, 3);
    assertNoWrites(calls);

    for (const ref of ['Room One', 'room-2', 'Kind Long']) {
      calls.length = 0;
      const dry = run(dir, ['room', 'delete', '--room', ref, '--json'], { fetchImpl });
      assert.equal(await dry.promise, 0, ref);
      assert.equal(dry.io.json().dryRun, true);
      assert.equal(dry.io.json().action, 'room delete');
      assert.equal(typeof dry.io.json().kind, 'string');
      assert.notEqual(dry.io.json().kind, 'GROK_BOT_AGENT_KIND_AGENT');
      assertNoWrites(calls);
    }

    calls.length = 0;
    const roomYes = run(dir, ['room', 'delete', '--room', 'room-1', '--yes', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push({ name, body: init?.body ? rpcBody(init) : null });
        if (name === 'ListGrokBotAgents') return roster(ROOM, ALPHA);
        if (name === 'DeleteGrokBotAgent') return jsonResponse({});
        throw new Error(name);
      },
    });
    assert.equal(await roomYes.promise, 0);
    assert.equal(roomYes.io.json().deleted, true);
    assert.equal(roomYes.io.json().roomId, 'room-1');
    const roomDeletes = calls.filter(row => row.name === 'DeleteGrokBotAgent');
    assert.equal(roomDeletes.length, 1);
    assert.equal(roomDeletes[0].body.id, 'room-1');

    calls.length = 0;
    const removeDry = run(dir, ['room', 'remove-member', '--room', 'Room One', '--user-id', '3', '--user-id', '4', '--json'], { fetchImpl });
    assert.equal(await removeDry.promise, 0);
    assert.equal(removeDry.io.json().dryRun, true);
    assert.deepEqual(removeDry.io.json().userIds, [3, 4]);
    assert.equal(removeDry.io.json().roomId, 'room-1');
    assertNoWrites(calls);

    const removeYes = run(dir, ['room', 'remove-member', '--room', 'room-1', '--user-id', '3', '--yes', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push({ name, body: init?.body ? rpcBody(init) : null });
        if (name === 'ListGrokBotAgents') return roster(ROOM);
        if (name === 'RemoveGrokBotRoomPeople') return jsonResponse({});
        throw new Error(name);
      },
    });
    assert.equal(await removeYes.promise, 0);
    assert.equal(removeYes.io.json().removed, true);
    assert.equal(removeYes.io.json().bot, null);
    const removal = calls.find(row => row.name === 'RemoveGrokBotRoomPeople');
    assert.equal(removal.body.agentId, 'room-1');
    assert.deepEqual(removal.body.userIds, [3]);

    calls.length = 0;
    const setDry = run(dir, ['room', 'set-members', '--room', 'Room One', '--member', 'Alpha', '--member', 'Beta', '--json'], { fetchImpl });
    assert.equal(await setDry.promise, 0);
    assert.equal(setDry.io.json().dryRun, true);
    assert.deepEqual(setDry.io.json().members.map(member => member.id), ['bot-alpha', 'bot-beta']);
    assertNoWrites(calls);

    const setYes = run(dir, ['room', 'set-members', '--room', 'room-1', '--member', 'bot-beta', '--yes', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push({ name, body: init?.body ? rpcBody(init) : null });
        if (name === 'ListGrokBotAgents') return roster(ROOM, ALPHA, BETA);
        if (name === 'SetGrokBotRoomMembers') return jsonResponse({ agent: room('room-1', 'Room One') });
        throw new Error(name);
      },
    });
    assert.equal(await setYes.promise, 0);
    const setBody = calls.find(row => row.name === 'SetGrokBotRoomMembers').body;
    assert.equal(setBody.agentId, 'room-1');
    assert.deepEqual(setBody.memberAgentIds, ['bot-beta']);
    assert.notDeepEqual(setBody.memberAgentIds, ['server-bot-beta']);

    calls.length = 0;
    const fuzzyMember = run(dir, ['room', 'set-members', '--room', 'Room One', '--member', 'Alpi', '--yes', '--json'], { fetchImpl });
    assert.equal(await fuzzyMember.promise, 3);
    assert.equal(fuzzyMember.io.json().error.code, 'AMBIGUOUS_BOT');
    assert.equal(calls.some(row => row === 'SetGrokBotRoomMembers' || row?.name === 'SetGrokBotRoomMembers'), false);

    calls.length = 0;
    const skillDry = run(dir, ['skill', 'remove', '--bot', 'Alpha', '--name', 'demo', '--json'], { fetchImpl });
    assert.equal(await skillDry.promise, 0);
    assert.equal(skillDry.io.json().dryRun, true);
    assert.equal(skillDry.io.json().name, 'demo');
    assert.equal(skillDry.io.json().botId, 'bot-alpha');
    assertNoWrites(calls);

    const skillYes = run(dir, ['skill', 'remove', '--bot', 'bot-alpha', '--name', 'demo', '--yes', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push({ name, body: init?.body ? rpcBody(init) : null });
        if (name === 'ListGrokBotAgents') return roster(ALPHA);
        if (name === 'RemoveGrokBotAgentSkill') return jsonResponse({
          marketplace: { marketplaceId: '1', displayName: 'local', description: '' },
          plugins: [],
        });
        throw new Error(name);
      },
    });
    assert.equal(await skillYes.promise, 0);
    assert.equal(skillYes.io.json().removed, true);
    const skillBody = calls.find(row => row.name === 'RemoveGrokBotAgentSkill').body;
    assert.equal(skillBody.agentId, 'bot-alpha');
    assert.equal(skillBody.name, 'demo');
  });
});

test('room create and add-member use Bot.id on one account', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const calls = [];
    const fetchImpl = async (url, init) => {
      const name = methodOf(url);
      calls.push({ name, auth: init.headers.authorization, body: rpcBody(init) });
      const auth = init.headers.authorization;
      if (name === 'ListGrokBotAgents') {
        if (auth === 'Bearer token-work') return roster(agent('bot-beta', 'Beta'));
        return roster(ALPHA, ALPINE, ROOM);
      }
      if (name === 'CreateGrokBotRoom') {
        const body = rpcBody(init);
        return jsonResponse({ agent: createdAgent(body, { name: body.name, kind: 'ROOM', id: 'server-room' }) });
      }
      if (name === 'AddGrokBotRoomPeople') {
        const body = rpcBody(init);
        return jsonResponse({ agent: room(body.agentId, 'Room One') });
      }
      throw new Error(name);
    };
    const created = run(dir, ['room', 'create', '--name', 'Standup', '--description', 'daily', '--member', 'Alpha', '--member', 'Alpine', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl,
    });
    assert.equal(await created.promise, 0);
    const createCall = calls.find(row => row.name === 'CreateGrokBotRoom');
    assert.equal(createCall.auth, 'Bearer token-default');
    assert.equal(createCall.body.name, 'Standup');
    assert.equal(createCall.body.description, 'daily');
    assert.deepEqual(createCall.body.memberAgentIds, ['bot-alpha', 'bot-alpine']);
    assert.equal(created.io.json().bot.kind, 'ROOM');
    assert.deepEqual(created.io.json().members.map(member => member.id), ['bot-alpha', 'bot-alpine']);

    calls.length = 0;
    const crossed = run(dir, ['room', 'create', '--name', 'Nope', '--member', 'Alpha', '--member', 'Beta', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl,
    });
    assert.equal(await crossed.promise, 3);
    assert.equal(crossed.io.json().error.code, 'USAGE');
    assert.match(crossed.io.json().error.message, /same account/);
    assert.equal(calls.some(row => row.name === 'CreateGrokBotRoom'), false);

    calls.length = 0;
    const crossedSet = run(dir, ['room', 'set-members', '--room', 'Room One', '--member', 'work:Beta', '--yes', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl,
    });
    assert.equal(await crossedSet.promise, 3);
    assert.equal(crossedSet.io.json().error.code, 'USAGE');
    assert.equal(calls.some(row => row.name === 'SetGrokBotRoomMembers'), false);

    const added = run(dir, ['room', 'add-member', '--room', 'Room One', '--user-id', '7', '--user-id', '8', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl,
    });
    assert.equal(await added.promise, 0);
    const addCall = calls.find(row => row.name === 'AddGrokBotRoomPeople');
    assert.equal(addCall.body.agentId, 'room-1');
    assert.deepEqual(addCall.body.userIds, [7, 8]);
    assert.equal(added.io.json().bot.id, 'room-1');

    calls.length = 0;
    const addBot = run(dir, ['room', 'add-member', '--room', 'Alpha', '--user-id', '7', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl,
    });
    assert.equal(await addBot.promise, 3);
    assert.equal(addBot.io.json().error.code, 'NOT_A_ROOM');
    assert.equal(calls.some(row => row.name === 'AddGrokBotRoomPeople'), false);
  });
});

test('skill add and update send content from a flag or a file', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'skill.md');
    await writeFile(file, 'from file\n');
    const calls = [];
    const fetchImpl = async (url, init) => {
      const name = methodOf(url);
      calls.push({ name, body: rpcBody(init) });
      if (name === 'ListGrokBotAgents') return roster(ALPHA);
      if (name === 'AddGrokBotAgentSkill' || name === 'UpdateGrokBotAgentSkill') return skillResult(rpcBody(init).name, rpcBody(init).content);
      throw new Error(name);
    };
    const added = run(dir, ['skill', 'add', '--bot', 'Alpha', '--name', 'demo', '--content', 'hello', '--description', 'about', '--json'], { fetchImpl });
    assert.equal(await added.promise, 0);
    const addBody = calls.find(row => row.name === 'AddGrokBotAgentSkill').body;
    assert.equal(addBody.agentId, 'bot-alpha');
    assert.equal(addBody.name, 'demo');
    assert.equal(addBody.content, 'hello');
    assert.equal(addBody.description, 'about');
    assert.equal(added.io.json().skill.name, 'demo');
    assert.equal(added.io.json().skill.sourcePath, 'demo/SKILL.md');
    assert.equal(added.io.json().skill.content, undefined);

    const fromFile = run(dir, ['skill', 'update', '--bot', 'bot-alpha', '--name', 'demo', '--content-file', file, '--json'], { fetchImpl });
    assert.equal(await fromFile.promise, 0);
    const updateBody = calls.find(row => row.name === 'UpdateGrokBotAgentSkill').body;
    assert.equal(updateBody.agentId, 'bot-alpha');
    assert.equal(updateBody.content, 'from file\n');
    assert.equal(Object.hasOwn(updateBody, 'description'), false);

    calls.length = 0;
    const missing = run(dir, ['skill', 'add', '--bot', 'Alpha', '--name', 'demo', '--content-file', join(dir, 'missing.md'), '--json'], { fetchImpl });
    assert.equal(await missing.promise, 3);
    assert.equal(missing.io.json().error.code, 'FILE_NOT_FOUND');
    assert.equal(calls.some(row => row.name === 'AddGrokBotAgentSkill'), false);
  });
});

test('bot create on --account uses that account token', async () => {
  await withDir(async (dir) => {
    await writeCred(dir, 'default', 'token-default');
    await writeCred(dir, 'work', 'token-work');
    const auths = [];
    const created = run(dir, ['bot', 'create', '--account', 'work', '--name', 'Work Bot', '--json'], {
      env: { GROK_BOT_ACCESS_TOKEN: '' },
      fetchImpl: async (url, init) => {
        auths.push(init.headers.authorization);
        if (methodOf(url) !== 'CreateGrokBotAgent') throw new Error(methodOf(url));
        const body = rpcBody(init);
        assert.equal(body.name, 'Work Bot');
        return jsonResponse({ agent: createdAgent(body), harness: 'BOX' });
      },
    });
    assert.equal(await created.promise, 0);
    assert.equal(created.io.json().account, 'work');
    assert.equal(created.io.json().harness, 'box');
    assert.deepEqual(auths, ['Bearer token-work']);
  });
});

test('wait accepts a send-message transcript entry as the bot reply', async () => {
  await withDir(async (dir) => {
    const calls = [];
    const waited = run(dir, ['wait', '--bot', 'Alpha', '--message-id', 'msg-1', '--json'], {
      fetchImpl: async (url, init) => {
        const name = methodOf(url);
        calls.push(name);
        if (name === 'ListGrokBotAgents') return roster(ALPHA);
        if (name === 'GetGrokBotSendStatus') return jsonResponse({});
        if (name === 'ListGrokBotTranscriptEntries') {
          return jsonResponse({
            generation: 1,
            entries: [
              transcriptEntry(1, 'user-1', 'message', { id: 'msg-1', kind: 'message', role: 'user', content: '请用一句话介绍你自己的职责' }),
              transcriptEntry(2, 'bot-1', 'send-message', { kind: 'send-message', message: { type: 'text', content: '我是 Webhook 测试员' } }),
            ],
          });
        }
        throw new Error(name);
      },
    });
    assert.equal(await waited.promise, 0);
    assert.equal(waited.io.json().endedBy, 'transcript');
    assert.equal(waited.io.json().text, '我是 Webhook 测试员');
    assert.equal(calls.includes('WatchGrokBotTranscripts'), false);
    assert.equal(calls.includes('SendGrokBotUserMessage'), false);
  });
});

test('createTurnWait keeps send-message text and drops a role=user entry', () => {
  const waiter = createTurnWait({ timeoutMs: 10_000, idleMs: 0, userText: 'hello', startedAt: 0 });
  waiter.push({
    type: 'entry',
    data: { entryId: 'user-1', entry: { kind: 'message', role: 'user', content: 'not the reply' } },
  }, 1);
  waiter.push({
    type: 'entry',
    data: {
      entryId: 'bot-1',
      entryKind: 'send-message',
      entry: { kind: 'send-message', message: { type: 'text', content: 'bot used the tool' } },
    },
  }, 2);
  const decision = waiter.noteStatus(false, 2);
  assert.equal(decision.reason, 'status-idle');
  assert.equal(decision.text, 'bot used the tool');

  const stopped = findReplyAfterMessage([
    { seq: '1', entryId: 'u', body: { id: 'msg-9', kind: 'message', role: 'user', content: 'ask' } },
    { seq: '2', entryId: 'tool', entryKind: 'send-message', body: { kind: 'send-message', content: 'tool reply' } },
    { seq: '3', entryId: 'next', body: { kind: 'message', role: 'user', content: 'later' } },
    { seq: '4', entryId: 'after', body: { kind: 'send-message', content: 'after the next user' } },
  ], 'msg-9');
  assert.equal(stopped.text, 'tool reply');
});
