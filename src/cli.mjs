import { execFile } from 'node:child_process';
import { access, constants, readFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createLogin, GrokBotClient, pollLogin } from 'grok-bot-sdk';
import { identityHash, loadOrMigrate, maskEmail, writeRegistry } from './accounts.mjs';
import { COMMAND_NAMES, parseArgs, validateCommand } from './args.mjs';
import { CLI_VERSION, DEFAULT_IDLE_SEC, DEFAULT_TIMEOUT_SEC, LOGIN_WAIT_SEC, START_TTL_SEC, STATUS_PROBE_INTERVAL_MS, TARGET_VERSION, WAIT_TRANSCRIPT_LIMIT } from './constants.mjs';
import { configDir, credentialPath, loadStoredSession, pendingPath, publicSession, readJsonFile, removeFile, writeSecret } from './config.mjs';
import { CliError, isUnauthorized, normalizeError } from './errors.mjs';
import { onShutdown } from './exit.mjs';
import { HELP } from './help.mjs';
import { matchBot } from './match.mjs';
import { redact } from './redact.mjs';
import { refreshSession, shouldRefreshAccessToken } from './refresh.mjs';
import { findReplyAfterMessage } from './reply.mjs';
import { detectRuntime, formatRuntimeLine, formatRuntimeVersion, unsupportedRuntime } from './runtime.mjs';
import { agentIsRunning, createTurnWait } from './wait.mjs';

const execFileAsync = promisify(execFile);

async function defaultOpen(url, platform) {
  if (platform === 'darwin') await execFileAsync('/usr/bin/open', [url]);
  else if (platform === 'win32') await execFileAsync('cmd.exe', ['/c', 'start', '', url]);
  else await execFileAsync('xdg-open', [url]);
}

function createQueue() {
  const items = [];
  let pending = null;
  let timer = null;
  let closed = false;
  let failure = null;
  const deliver = (result) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const resolve = pending;
    pending = null;
    resolve?.(result);
  };
  return {
    push(value) {
      if (closed) return;
      if (pending) deliver({ value });
      else items.push(value);
    },
    close(error) {
      if (closed) return;
      closed = true;
      failure = error ?? null;
      if (pending) deliver(failure ? { error: failure } : { done: true });
    },
    cancel() {
      this.close();
    },
    next(ms) {
      if (items.length) return Promise.resolve({ value: items.shift() });
      if (closed) return Promise.resolve(failure ? { error: failure } : { done: true });
      return new Promise((resolve) => {
        pending = resolve;
        timer = setTimeout(() => {
          timer = null;
          pending = null;
          resolve({ timeout: true });
        }, Math.max(0, ms));
      });
    },
    drain() {
      return items.splice(0, items.length);
    },
  };
}

function writeJson(ctx, value) {
  ctx.stdout.write(`${JSON.stringify(redact(value))}\n`);
}

function asCliError(error) {
  return error instanceof CliError ? error : normalizeError(error);
}

function fail(ctx, error) {
  const normalized = asCliError(error);
  const exitCode = normalized.exitCode ?? 4;
  const extra = { ...(normalized.extra ?? {}) };
  delete extra.exitCode;
  if (ctx.json) writeJson(ctx, { ok: false, error: { code: normalized.code, message: normalized.message, ...extra, exitCode } });
  else ctx.stderr.write(`${normalized.code}: ${normalized.message}\n`);
  return exitCode;
}

function ok(ctx, payload, human) {
  if (ctx.json) writeJson(ctx, { ok: true, ...payload });
  else if (human != null) ctx.stdout.write(human.endsWith('\n') ? human : `${human}\n`);
  return 0;
}

function clientFor(ctx, session) {
  return new GrokBotClient({
    accessToken: session.accessToken,
    fetchImpl: ctx.fetchImpl,
    version: TARGET_VERSION,
    ...session.teamId !== undefined ? { teamId: session.teamId } : {},
  });
}

function envToken(ctx) {
  const token = ctx.env.GROK_BOT_ACCESS_TOKEN;
  return typeof token === 'string' && token ? token : '';
}

function bindAccount(ctx, alias) {
  ctx.account = alias;
  ctx.profile = alias;
  ctx.credentialFile = credentialPath(ctx.configDirectory, alias);
  ctx.pendingFile = pendingPath(ctx.configDirectory, alias);
}

async function registryOf(ctx) {
  if (!ctx.registry) ctx.registry = await loadOrMigrate(ctx.configDirectory, new Date(ctx.now()).toISOString());
  return ctx.registry;
}

async function persistRegistry(ctx) {
  const registry = await registryOf(ctx);
  ctx.registrySave = (ctx.registrySave ?? Promise.resolve()).then(() => writeRegistry(ctx.configDirectory, registry));
  await ctx.registrySave;
  registry.persisted = true;
}

async function touchAccount(ctx, alias) {
  const registry = await registryOf(ctx);
  const row = registry.accounts.find(item => item.alias === alias);
  if (!row || !registry.persisted && registry.accounts.length === 0) return;
  row.lastUsedAt = new Date(ctx.now()).toISOString();
  await persistRegistry(ctx);
}

async function rememberAccount(ctx, alias, fields = {}) {
  const registry = await registryOf(ctx);
  const now = new Date(ctx.now()).toISOString();
  let row = registry.accounts.find(item => item.alias === alias);
  if (!row) {
    row = { alias, label: '', addedAt: now, lastUsedAt: now, identityHash: '' };
    registry.accounts.push(row);
  }
  if (fields.label) row.label = fields.label;
  if (fields.identityHash) row.identityHash = fields.identityHash;
  row.lastUsedAt = now;
  if (fields.makeDefault) registry.default = alias;
  await persistRegistry(ctx);
  return registry;
}

async function sessionFor(ctx, alias) {
  const file = credentialPath(ctx.configDirectory, alias);
  if (envToken(ctx) && alias === ctx.account) {
    return { accessToken: envToken(ctx), refreshToken: null, teamId: undefined, source: 'env', path: file, refreshed: true };
  }
  return loadStoredSession(file);
}

async function prepareSessionFor(ctx, alias) {
  const session = await sessionFor(ctx, alias);
  const file = credentialPath(ctx.configDirectory, alias);
  if (!session) throw new CliError('NOT_LOGGED_IN', 'Not logged in. Run: grok-bot login', 2, { profile: alias, credentialPath: file });
  if (session.source === 'file' && session.refreshToken && shouldRefreshAccessToken(session.accessToken, ctx.now())) {
    try {
      return await refreshSession(ctx, session);
    } catch (error) {
      if (error instanceof CliError && error.code === 'NETWORK') {
        ctx.stderr.write('Token refresh failed. Trying the saved access token.\n');
        return session;
      }
      throw error;
    }
  }
  return session;
}

async function withAccount(ctx, alias, fn) {
  let session = await prepareSessionFor(ctx, alias);
  const run = (current) => fn(clientFor(ctx, current), current);
  let result;
  try {
    result = await run(session);
  } catch (error) {
    if (!isUnauthorized(error) || session.source !== 'file' || !session.refreshToken || session.refreshed) throw error;
    session = await refreshSession(ctx, session);
    result = await run(session);
  }
  await touchAccount(ctx, alias);
  return result;
}

function labelFor(registry, alias) {
  return registry.accounts.find(row => row.alias === alias)?.label ?? '';
}

async function registeredAliases(ctx) {
  const registry = await registryOf(ctx);
  const aliases = registry.accounts.map(row => row.alias);
  if (envToken(ctx) && !aliases.includes(ctx.account)) aliases.push(ctx.account);
  return aliases;
}

function rosterFor(ctx, alias) {
  if (!ctx.rosters) ctx.rosters = new Map();
  if (!ctx.rosters.has(alias)) {
    ctx.rosters.set(alias, withAccount(ctx, alias, (client) => client.listBots()));
  }
  return ctx.rosters.get(alias);
}

function parseBotRef(query, aliases) {
  const text = String(query ?? '');
  const index = text.indexOf(':');
  if (index <= 0) return { account: null, query: text };
  const alias = text.slice(0, index);
  if (!aliases.has(alias)) return { account: null, query: text };
  return { account: alias, query: text.slice(index + 1) };
}

function candidateOf(account, bot) {
  return { account, id: bot.id, name: bot.name };
}

async function searchableAliases(ctx) {
  const names = await registeredAliases(ctx);
  const targets = [];
  for (const alias of names) {
    if (envToken(ctx) && alias === ctx.account) {
      targets.push(alias);
      continue;
    }
    const parsed = await readJsonFile(credentialPath(ctx.configDirectory, alias));
    if (parsed === undefined) continue;
    targets.push(alias);
  }
  return targets;
}

const ROOM_KINDS = new Set(['2', 'ROOM', 'GROK_BOT_AGENT_KIND_ROOM']);

function isRoomKind(kind) {
  return ROOM_KINDS.has(String(kind ?? ''));
}

async function resolveBot(ctx, query, options = {}) {
  const exact = options.exact === true;
  const requireRoom = options.requireRoom === true;
  const registry = await registryOf(ctx);
  const aliases = new Set(registry.accounts.map(row => row.alias));
  const ref = parseBotRef(query, aliases);
  if (ref.account && !ref.query) throw new CliError('USAGE', 'Bot reference is missing a name after the account prefix.', 3);
  if (ctx.accountExplicit && ref.account && ref.account !== ctx.account) {
    throw new CliError('USAGE', `Bot account "${ref.account}" does not match --account ${ctx.account}.`, 3);
  }
  const scoped = ctx.accountExplicit || Boolean(ref.account);
  const targets = scoped ? [ref.account || ctx.account] : await searchableAliases(ctx);
  if (!targets.length) {
    throw new CliError('NOT_LOGGED_IN', 'Not logged in. Run: grok-bot login', 2, {
      profile: ctx.account,
      credentialPath: credentialPath(ctx.configDirectory, ctx.account),
    });
  }
  const hits = [];
  const failures = [];
  await Promise.all(targets.map(async (alias) => {
    try {
      const roster = await rosterFor(ctx, alias);
      const match = matchBot(roster.bots, ref.query, { exact });
      if (match.bot) hits.push({ account: alias, bot: match.bot, inexact: false });
      else if (match.ambiguous) {
        for (const bot of match.ambiguous) hits.push({ account: alias, bot, inexact: match.inexact === true });
      }
    } catch (error) {
      const normalized = asCliError(error);
      failures.push({ account: alias, code: normalized.code, message: normalized.message, exitCode: normalized.exitCode ?? 4 });
    }
  }));
  hits.sort((left, right) => left.account.localeCompare(right.account) || left.bot.name.localeCompare(right.bot.name) || left.bot.id.localeCompare(right.bot.id));
  const exactHits = hits.filter(hit => !hit.inexact);
  const chosen = exactHits.length ? exactHits : hits;
  const noun = requireRoom ? 'room' : 'bot';
  if (hits.length && !exactHits.length) {
    const candidates = hits.map(hit => candidateOf(hit.account, hit.bot));
    throw new CliError('AMBIGUOUS_BOT', `"${query}" is not an exact ${noun} id or full name. Pass an id or the full name. Matched: ${candidates.map(item => `${item.account}:${item.name} (${item.id})`).join(', ')}.`, 3, { candidates });
  }
  if (chosen.length === 1) {
    if (!scoped) {
      for (const failure of failures) ctx.stderr.write(`Skipping account ${failure.account}: ${failure.code}\n`);
    }
    const resolved = { account: chosen[0].account, bot: chosen[0].bot };
    if (requireRoom && !isRoomKind(resolved.bot.kind)) {
      throw new CliError('NOT_A_ROOM', `"${resolved.bot.name}" (${resolved.bot.id}) is not a room.`, 3, {
        account: resolved.account,
        id: resolved.bot.id,
        name: resolved.bot.name,
        kind: resolved.bot.kind,
      });
    }
    return resolved;
  }
  if (chosen.length > 1) {
    const candidates = chosen.map(hit => candidateOf(hit.account, hit.bot));
    const example = `${candidates[0].account}:${candidates[0].name}`;
    const hint = exact
      ? `Pass ${requireRoom ? 'a room' : 'a bot'} id or the full name.`
      : `Pass a bot id or an account prefix such as ${example}.`;
    throw new CliError('AMBIGUOUS_BOT', `Multiple ${noun}s match "${query}": ${candidates.map(item => `${item.account}:${item.name} (${item.id})`).join(', ')}. ${hint}`, 3, { candidates });
  }
  if (failures.length && (scoped || targets.length === 1)) {
    const failure = failures[0];
    throw new CliError(failure.code, failure.message, failure.exitCode, { account: failure.account });
  }
  if (failures.length) {
    const listed = failures.map(failure => `${failure.account} (${failure.code})`).join(', ');
    throw new CliError('BOT_NOT_FOUND', `No bot matches "${query}". These accounts could not be searched: ${listed}.`, 3, {
      failedAccounts: failures.map(failure => ({ account: failure.account, code: failure.code })),
    });
  }
  throw new CliError('BOT_NOT_FOUND', `No bot matches "${query}".`, 3);
}

async function withBot(ctx, query, fn, options) {
  const resolved = await resolveBot(ctx, query, options);
  return withAccount(ctx, resolved.account, (client, session) => fn(client, session, resolved));
}

async function resolveMembers(ctx, refs, { exact = false, account = null } = {}) {
  const resolved = [];
  for (const ref of refs) {
    const hit = await resolveBot(ctx, ref, { exact });
    if (account && hit.account !== account) {
      throw new CliError('USAGE', `Member "${hit.bot.name}" is on account "${hit.account}", not "${account}". Room members must use the same account.`, 3);
    }
    resolved.push(hit);
  }
  if (!account && resolved.length > 1) {
    const owner = resolved[0].account;
    const other = resolved.find(hit => hit.account !== owner);
    if (other) {
      throw new CliError('USAGE', `Room members must use the same account. "${resolved[0].bot.name}" is on "${owner}" and "${other.bot.name}" is on "${other.account}".`, 3);
    }
  }
  return resolved;
}

function managedBot(bot) {
  return {
    id: bot.id,
    serverId: bot.serverId ?? null,
    name: bot.name,
    title: bot.title ?? '',
    kind: bot.kind ?? '',
    role: bot.role ?? '',
  };
}

function requireServerId(bot) {
  if (typeof bot.serverId !== 'string' || !bot.serverId) {
    throw new CliError('USAGE', `Bot "${bot.name}" (${bot.id}) has no server id, so it cannot be updated.`, 3);
  }
  return bot.serverId;
}

function publicSkill(skill) {
  if (!skill) return null;
  return {
    name: skill.name ?? '',
    description: skill.description ?? '',
    sourcePath: skill.sourcePath ?? '',
  };
}

function dryRun(ctx, action, fields) {
  const id = fields.botId || fields.roomId || '';
  const name = fields.botName || fields.roomName || '';
  const kind = fields.kind ? ` ${fields.kind}` : '';
  return ok(ctx, { dryRun: true, action, ...fields }, `dry-run ${action} ${fields.account} ${name} (${id})${kind}`);
}

async function readSkillContent(flags) {
  if (flags.content != null) return flags.content;
  const path = resolve(flags.contentFile);
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new CliError('FILE_NOT_FOUND', `Cannot read skill content ${flags.contentFile}`, 3);
  }
}

function renderTemplate(template, vars) {
  return String(template).replace(/\{(reply|fromName|fromAccount)\}/g, (match, key) => vars[key] ?? match);
}

function withoutExit(row) {
  const { exitCode: _exitCode, ...rest } = row;
  return rest;
}

function finishFanout(ctx, accounts, extra, human) {
  const failed = accounts.filter(row => row.ok === false);
  const body = { ...extra, accounts: accounts.map(withoutExit) };
  if (accounts.length > 0 && failed.length === accounts.length) {
    const first = failed[0];
    const exitCode = first.exitCode ?? 4;
    if (ctx.json) {
      writeJson(ctx, { ok: false, error: { code: first.error.code, message: first.error.message, exitCode }, ...body });
    } else {
      if (human) ctx.stdout.write(human.endsWith('\n') ? human : `${human}\n`);
      ctx.stderr.write(`${first.error.code}: ${first.error.message}\n`);
    }
    return exitCode;
  }
  return ok(ctx, body, human);
}

function entryText(entry) {
  const body = entry?.body;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.content === 'string') return body.content;
  if (typeof body.message?.content === 'string') return body.message.content;
  return null;
}

function summarizeBot(bot) {
  return { id: bot.id, name: bot.name, title: bot.title, kind: bot.kind, role: bot.role, sessionId: bot.sessionId };
}

function accountSummary(me) {
  return {
    identityPresent: Boolean(me?.authId || me?.userId),
    emailPresent: Boolean(me?.email),
    namePresent: Boolean(me?.name || me?.displayName),
    teamPresent: me?.teamId !== undefined && me?.teamId !== null,
  };
}

async function openLogin(ctx, loginUrl) {
  if (ctx.noOpen) return;
  try {
    await ctx.openBrowser(loginUrl);
  } catch {
    ctx.stderr.write('Could not open a browser. Open the login URL yourself.\n');
  }
}

async function savePending(ctx, flow, expiresAt) {
  await writeSecret(ctx.pendingFile, `${JSON.stringify({
    uuid: flow.uuid,
    verifier: flow.verifier,
    loginUrl: flow.loginUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    profile: ctx.profile,
  })}\n`);
}

async function loadPending(ctx) {
  const parsed = await readJsonFile(ctx.pendingFile);
  if (parsed === undefined) throw new CliError('LOGIN_NOT_STARTED', 'No pending login. Run: grok-bot login --start', 3);
  if (!parsed || typeof parsed.uuid !== 'string' || typeof parsed.verifier !== 'string' || typeof parsed.loginUrl !== 'string') {
    throw new CliError('LOGIN_NOT_STARTED', 'The pending login is invalid. Run: grok-bot login --start', 3);
  }
  const expiresAt = Date.parse(parsed.expiresAt);
  return { uuid: parsed.uuid, verifier: parsed.verifier, loginUrl: parsed.loginUrl, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}

async function pollUntilApproved(ctx, flow, { timeoutMs, expiresAt }) {
  const deadline = ctx.now() + timeoutMs;
  if (expiresAt != null && ctx.now() >= expiresAt) {
    throw new CliError('LOGIN_EXPIRED', 'The pending login expired. Run: grok-bot login --start', 2);
  }
  try {
    return await pollLogin(flow, {
      fetchImpl: ctx.fetchImpl,
      maxAttempts: 1_000_000,
      sleep: async (milliseconds) => {
        if (expiresAt != null && ctx.now() >= expiresAt) throw new CliError('LOGIN_EXPIRED', 'The pending login expired. Run: grok-bot login --start', 2);
        if (ctx.now() >= deadline) throw new CliError('LOGIN_TIMED_OUT', `Login timed out after ${Math.round(timeoutMs / 1000)}s.`, 5);
        const cap = Math.min(milliseconds, deadline - ctx.now(), expiresAt == null ? milliseconds : expiresAt - ctx.now());
        if (cap <= 0) {
          if (expiresAt != null && expiresAt <= deadline) throw new CliError('LOGIN_EXPIRED', 'The pending login expired. Run: grok-bot login --start', 2);
          throw new CliError('LOGIN_TIMED_OUT', `Login timed out after ${Math.round(timeoutMs / 1000)}s.`, 5);
        }
        await ctx.sleep(cap);
      },
      onPending: (attempt) => {
        if (attempt === 1 || attempt % 5 === 0) ctx.stderr.write(`Waiting for browser approval (attempt ${attempt}).\n`);
      },
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error?.message === 'SIGN_IN_POLICY_VIOLATION') throw new CliError('SIGN_IN_POLICY_VIOLATION', 'Sign-in was refused by organization policy.', 2);
    if (error?.message === 'LOGIN_TIMED_OUT') throw new CliError('LOGIN_TIMED_OUT', 'Login timed out.', 5);
    throw new CliError('LOGIN_POLL_FAILED', 'The login poll failed.', 4);
  }
}

async function findIdentityClash(ctx, hash, alias) {
  if (!hash) return '';
  const registry = await registryOf(ctx);
  for (const row of registry.accounts) {
    if (row.alias !== alias && row.identityHash && row.identityHash === hash) return row.alias;
  }
  for (const row of registry.accounts) {
    if (row.alias === alias || row.identityHash) continue;
    try {
      const me = await withAccount(ctx, row.alias, (client) => client.getMe());
      const other = identityHash(me);
      if (!other) continue;
      row.identityHash = other;
      const label = maskEmail(me?.email);
      if (label && !row.label) row.label = label;
      await persistRegistry(ctx);
      if (other === hash) return row.alias;
    } catch {
      // A dead credential cannot prove this is the same person.
    }
  }
  return '';
}

async function commitLogin(ctx, session) {
  const record = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    ...session.selectedTeamId !== undefined ? { selectedTeamId: session.selectedTeamId } : {},
  };
  if (typeof record.accessToken !== 'string' || typeof record.refreshToken !== 'string') {
    throw new CliError('LOGIN_POLL_FAILED', 'The login response did not include credentials.', 4);
  }
  let label = '';
  let hash = '';
  try {
    const me = await clientFor(ctx, {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      teamId: session.selectedTeamId,
      source: 'memory',
      path: ctx.credentialFile,
      refreshed: true,
    }).getMe();
    label = maskEmail(me?.email);
    hash = identityHash(me);
  } catch {
    ctx.stderr.write('Could not read an account label.\n');
  }
  if (hash) {
    const clash = await findIdentityClash(ctx, hash, ctx.account);
    if (clash) {
      await removeFile(ctx.pendingFile);
      throw new CliError('ACCOUNT_ALREADY_ADDED', `This account is already added as ${clash}.`, 3, { alias: clash, account: clash });
    }
  }
  await writeSecret(ctx.credentialFile, `${JSON.stringify(record)}\n`);
  await removeFile(ctx.pendingFile);
  const registry = await rememberAccount(ctx, ctx.account, { label, identityHash: hash });
  return ok(ctx, {
    profile: ctx.profile,
    account: ctx.account,
    defaultAccount: registry.default,
    credentialPath: ctx.credentialFile,
    accessTokenPresent: true,
    refreshTokenPresent: true,
    selectedTeamIdPresent: session.selectedTeamId !== undefined,
    label,
  }, `Saved credentials for account ${ctx.account}\n${ctx.credentialFile}`);
}

async function commandLogin(ctx, flags) {
  const timeoutSec = flags.timeout ?? (flags.start ? START_TTL_SEC : LOGIN_WAIT_SEC);
  const timeoutMs = timeoutSec * 1000;
  if (flags.wait) {
    const pending = await loadPending(ctx);
    const session = await pollUntilApproved(ctx, pending, { timeoutMs, expiresAt: pending.expiresAt });
    return commitLogin(ctx, session);
  }
  const flow = createLogin();
  const expiresAt = ctx.now() + timeoutMs;
  await savePending(ctx, flow, expiresAt);
  const payload = { loginUrl: flow.loginUrl, expiresAt: new Date(expiresAt).toISOString(), profile: ctx.profile };
  if (flags.start) {
    await openLogin(ctx, flow.loginUrl);
    return ok(ctx, payload, `Login URL:\n${flow.loginUrl}\nExpires: ${payload.expiresAt}`);
  }
  if (ctx.json) ctx.stderr.write(`Login URL: ${flow.loginUrl}\nExpires: ${payload.expiresAt}\n`);
  else ctx.stdout.write(`Login URL:\n${flow.loginUrl}\nExpires: ${payload.expiresAt}\n`);
  await openLogin(ctx, flow.loginUrl);
  const session = await pollUntilApproved(ctx, flow, { timeoutMs, expiresAt });
  return commitLogin(ctx, session);
}

async function credentialState(ctx, alias) {
  const file = credentialPath(ctx.configDirectory, alias);
  try {
    const session = await loadStoredSession(file);
    if (!session) return { credentials: false, source: 'missing', file };
    return { credentials: true, source: 'file', file };
  } catch (error) {
    if (error instanceof CliError && error.code === 'CREDENTIALS_INVALID') return { credentials: false, source: 'invalid', file };
    throw error;
  }
}

async function commandAccountsList(ctx, flags) {
  const registry = await registryOf(ctx);
  const rows = await Promise.all(registry.accounts.map(async (row) => {
    const state = await credentialState(ctx, row.alias);
    const item = {
      alias: row.alias,
      label: row.label ?? '',
      default: row.alias === registry.default,
      credentials: state.credentials,
      source: state.source,
    };
    if (!flags.check) return { item };
    if (!state.credentials) {
      const code = state.source === 'invalid' ? 'CREDENTIALS_INVALID' : 'NOT_LOGGED_IN';
      return { item: { ...item, check: { ok: false, code } } };
    }
    try {
      const me = await withAccount(ctx, row.alias, (client) => client.getMe());
      const label = maskEmail(me?.email);
      const hash = identityHash(me);
      if (label) item.label = label;
      return { item: { ...item, check: { ok: true } }, label, hash, alias: row.alias };
    } catch (error) {
      return { item: { ...item, check: { ok: false, code: asCliError(error).code } } };
    }
  }));
  let changed = false;
  for (const row of rows) {
    if (!row.hash && !row.label) continue;
    const stored = registry.accounts.find(item => item.alias === row.alias);
    if (!stored) continue;
    if (row.label && stored.label !== row.label) {
      stored.label = row.label;
      changed = true;
    }
    if (row.hash && stored.identityHash !== row.hash) {
      stored.identityHash = row.hash;
      changed = true;
    }
  }
  if (changed) await persistRegistry(ctx);
  const accounts = rows.map(row => row.item);
  const lines = accounts.map(row => `${row.default ? '*' : ' '} ${row.alias}\t${row.label}\t${row.source}\tcredentials=${row.credentials}${row.check ? `\t${row.check.ok ? 'ok' : row.check.code}` : ''}`).join('\n');
  return ok(ctx, { default: registry.default, accounts }, lines || '(no accounts)');
}

async function commandAccountsUse(ctx, alias) {
  const registry = await registryOf(ctx);
  const known = registry.accounts.some(row => row.alias === alias);
  const state = await credentialState(ctx, alias);
  if (!known && state.source === 'missing') throw new CliError('ACCOUNT_NOT_FOUND', `No account named ${alias}.`, 3);
  const next = await rememberAccount(ctx, alias, { makeDefault: true });
  return ok(ctx, { account: alias, default: next.default }, `Default account is ${alias}`);
}

async function commandAccountsRename(ctx, previous, next) {
  if (previous === next) throw new CliError('USAGE', 'accounts rename needs two different aliases', 3);
  const registry = await registryOf(ctx);
  const fromCred = credentialPath(ctx.configDirectory, previous);
  const toCred = credentialPath(ctx.configDirectory, next);
  const fromPending = pendingPath(ctx.configDirectory, previous);
  const toPending = pendingPath(ctx.configDirectory, next);
  const known = registry.accounts.some(row => row.alias === previous);
  const previousState = await credentialState(ctx, previous);
  const pendingExists = (await readJsonFile(fromPending)) !== undefined;
  if (!known && previousState.source === 'missing' && !pendingExists) throw new CliError('ACCOUNT_NOT_FOUND', `No account named ${previous}.`, 3);
  if (registry.accounts.some(row => row.alias === next)) throw new CliError('ACCOUNT_EXISTS', `Account ${next} already exists.`, 3);
  if ((await readJsonFile(toCred)) !== undefined || (await readJsonFile(toPending)) !== undefined) {
    throw new CliError('ACCOUNT_EXISTS', `Account ${next} already exists.`, 3);
  }
  if (previousState.source !== 'missing') await rename(fromCred, toCred);
  if (pendingExists) await rename(fromPending, toPending);
  const row = registry.accounts.find(item => item.alias === previous);
  if (row) row.alias = next;
  else registry.accounts.push({ alias: next, label: '', addedAt: new Date(ctx.now()).toISOString(), lastUsedAt: new Date(ctx.now()).toISOString(), identityHash: '' });
  if (registry.default === previous) registry.default = next;
  await persistRegistry(ctx);
  if (ctx.account === previous) bindAccount(ctx, next);
  return ok(ctx, { account: next, previous, default: registry.default }, `Renamed ${previous} to ${next}`);
}

async function commandAccountsRemove(ctx, alias) {
  const registry = await registryOf(ctx);
  const known = registry.accounts.some(row => row.alias === alias);
  const removedCredential = await removeFile(credentialPath(ctx.configDirectory, alias));
  const removedPending = await removeFile(pendingPath(ctx.configDirectory, alias));
  if (!known && !removedCredential && !removedPending) throw new CliError('ACCOUNT_NOT_FOUND', `No account named ${alias}.`, 3);
  registry.accounts = registry.accounts.filter(row => row.alias !== alias);
  if (registry.default === alias) {
    const remaining = [...registry.accounts].sort((left, right) => left.alias.localeCompare(right.alias));
    registry.default = remaining[0]?.alias ?? 'default';
  }
  await persistRegistry(ctx);
  return ok(ctx, { account: alias, removed: true, default: registry.default }, `Removed account ${alias}`);
}

async function commandAccounts(ctx, flags) {
  const [sub, ...rest] = flags.args ?? [];
  if (sub === 'list') return commandAccountsList(ctx, flags);
  if (sub === 'add') {
    bindAccount(ctx, rest[0]);
    ctx.accountExplicit = true;
    return commandLogin(ctx, flags);
  }
  if (sub === 'use') return commandAccountsUse(ctx, rest[0]);
  if (sub === 'rename') return commandAccountsRename(ctx, rest[0], rest[1]);
  if (sub === 'remove') return commandAccountsRemove(ctx, rest[0]);
  throw new CliError('USAGE', 'accounts requires list, add, use, rename, or remove', 3);
}

async function commandLogout(ctx) {
  const removedCredential = await removeFile(ctx.credentialFile);
  const removedPending = await removeFile(ctx.pendingFile);
  return ok(ctx, {
    profile: ctx.profile,
    credentialPath: ctx.credentialFile,
    removed: removedCredential || removedPending,
  }, removedCredential || removedPending ? `Removed credentials for profile ${ctx.profile}` : `Profile ${ctx.profile} was already logged out`);
}

async function commandStatus(ctx, flags) {
  if (flags?.allAccounts) return commandStatusAll(ctx);
  return withAccount(ctx, ctx.account, async (client, session) => {
    const me = await client.getMe();
    const summary = accountSummary(me);
    return ok(ctx, {
      loggedIn: true,
      profile: ctx.profile,
      source: session.source,
      credentialPath: session.path,
      account: summary,
    }, [
      'loggedIn: true',
      `profile: ${ctx.profile}`,
      `source: ${session.source}`,
      `credentialPath: ${session.path}`,
      `identityPresent: ${summary.identityPresent}`,
      `emailPresent: ${summary.emailPresent}`,
      `namePresent: ${summary.namePresent}`,
      `teamPresent: ${summary.teamPresent}`,
    ].join('\n'));
  });
}

async function commandStatusAll(ctx) {
  const registry = await registryOf(ctx);
  const aliases = await registeredAliases(ctx);
  const accounts = await Promise.all(aliases.map(async (alias) => {
    const label = labelFor(registry, alias);
    const state = await credentialState(ctx, alias);
    try {
      return await withAccount(ctx, alias, async (client, session) => {
        const summary = accountSummary(await client.getMe());
        return {
          account: alias,
          label,
          ok: true,
          loggedIn: true,
          source: session.source,
          credentialPath: session.path,
          ...summary,
        };
      });
    } catch (error) {
      const normalized = asCliError(error);
      return {
        account: alias,
        label,
        ok: false,
        loggedIn: false,
        source: state.source === 'file' ? 'file' : state.source,
        credentialPath: state.file,
        exitCode: normalized.exitCode ?? 4,
        error: { code: normalized.code, message: normalized.message },
      };
    }
  }));
  const lines = accounts.map(row => row.ok
    ? `${row.account}\tloggedIn\t${row.source}`
    : `${row.account}\t${row.error.code}`).join('\n');
  return finishFanout(ctx, accounts, {}, lines || '(no accounts)');
}

async function commandBots(ctx, flags) {
  if (flags?.allAccounts) return commandBotsAll(ctx);
  return withAccount(ctx, ctx.account, async (client) => {
    const roster = await client.listBots();
    const bots = roster.bots.map(summarizeBot);
    const lines = bots.map(bot => `${bot.id}\t${bot.name}\t${bot.role}\t${bot.sessionId}`).join('\n');
    return ok(ctx, { account: ctx.account, count: bots.length, truncated: roster.truncated, bots }, lines || '(no bots)');
  });
}

async function commandBotsAll(ctx) {
  const registry = await registryOf(ctx);
  const aliases = await registeredAliases(ctx);
  const accounts = await Promise.all(aliases.map(async (alias) => {
    const label = labelFor(registry, alias);
    const state = await credentialState(ctx, alias);
    if (state.source === 'missing' && !(envToken(ctx) && alias === ctx.account)) {
      return {
        account: alias,
        label,
        ok: false,
        count: 0,
        truncated: false,
        exitCode: 2,
        error: { code: 'NOT_LOGGED_IN', message: 'Not logged in. Run: grok-bot login' },
      };
    }
    try {
      const roster = await rosterFor(ctx, alias);
      const bots = roster.bots.map(bot => ({ account: alias, ...summarizeBot(bot) }));
      return {
        account: alias,
        label,
        ok: true,
        count: bots.length,
        truncated: roster.truncated,
        bots,
      };
    } catch (error) {
      const normalized = asCliError(error);
      return {
        account: alias,
        label,
        ok: false,
        count: 0,
        truncated: false,
        exitCode: normalized.exitCode ?? 4,
        error: { code: normalized.code, message: normalized.message },
      };
    }
  }));
  const bots = accounts.flatMap(row => row.bots ?? []);
  const publicAccounts = accounts.map(({ bots: _bots, ...row }) => row);
  const lines = [
    ...publicAccounts.map(row => row.ok ? `${row.account}\t${row.count}\ttruncated=${row.truncated}` : `${row.account}\t${row.error.code}`),
    ...bots.map(bot => `${bot.account}\t${bot.id}\t${bot.name}\t${bot.role}\t${bot.sessionId}`),
  ].join('\n');
  return finishFanout(ctx, publicAccounts, { bots }, lines || '(no accounts)');
}

async function commandSessions(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listSessions(resolved.bot.id);
    const lines = result.sessions.map(session => `${session.sessionId}\t${session.kind}\t${session.lastActivityAtMs ?? ''}`).join('\n');
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: result.sessions.length, sessions: result.sessions }, lines || '(no sessions)');
  });
}

async function commandTranscript(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listTranscript({ botId: resolved.bot.id, sessionId: flags.session ?? '', limit: flags.limit ?? 20 });
    const entries = result.entries.map(entry => ({
      seq: entry.seq,
      updatedSeq: entry.updatedSeq,
      entryId: entry.entryId,
      entryKind: entry.entryKind,
      bodyOmitted: entry.bodyOmitted,
      text: entryText(entry),
    }));
    const lines = entries.map(entry => `[${entry.seq}] ${entry.entryKind}\n${entry.text ?? ''}`).join('\n');
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, generation: result.generation, count: entries.length, unreadAnchor: result.unreadAnchor, entries }, lines || '(no entries)');
  });
}

async function commandTasks(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const [agentTasks, tasks] = await Promise.all([
      client.listAgentTasks({ botId: resolved.bot.id }),
      client.listTasks({ botId: resolved.bot.id, sessionId: flags.session ?? '' }),
    ]);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      agentTasks: agentTasks.tasks,
      tasks: tasks.tasks,
    }, `agentTasks: ${agentTasks.tasks.length}\ntasks: ${tasks.tasks.length}`);
  });
}

async function commandTodos(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentTodos(resolved.bot.id);
    const lines = result.todos.map(todo => `${todo.status}\t${todo.content}`).join('\n');
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: result.todos.length, todos: result.todos }, lines || '(no todos)');
  });
}

async function commandSkills(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentSkills(resolved.bot.id);
    const skills = result.skills.map(skill => ({ id: skill.id, name: skill.name, description: skill.description, source: skill.source, body: skill.body }));
    const lines = skills.map(skill => `${skill.name}\t${skill.source}`).join('\n');
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: skills.length, skills }, lines || '(no skills)');
  });
}

async function commandCapabilities(ctx) {
  return withAccount(ctx, ctx.account, async (client) => {
    const capabilities = await client.getRuntimeCapabilities();
    return ok(ctx, { account: ctx.account, capabilities }, Object.entries(capabilities).map(([key, value]) => `${key}: ${value}`).join('\n'));
  });
}

async function commandBox(ctx) {
  return withAccount(ctx, ctx.account, async (client) => {
    const box = await client.getSandBoxRunState();
    return ok(ctx, { account: ctx.account, box }, `runState: ${box.runState}\nimageUpdateAvailable: ${box.imageUpdateAvailable}`);
  });
}

async function attachmentArgs(files) {
  const paths = [];
  for (const file of files) {
    const path = resolve(file);
    try {
      await access(path, constants.R_OK);
    } catch {
      throw new CliError('FILE_NOT_FOUND', `Cannot read attachment ${file}`, 3);
    }
    paths.push(path);
  }
  return { attachmentPaths: paths, attachmentNames: paths.map(file => basename(file)) };
}

function publicEvent(event) {
  return { type: event.type, ...event.id !== undefined ? { id: event.id } : {}, data: event.data };
}

function formatEvent(event) {
  if (event.type === 'message') return `message ${event.data?.text ?? ''}`;
  if (event.type === 'turn.failed') return `turn.failed ${event.data?.summary ?? ''}`;
  if (event.type === 'agent.state') {
    const live = event.data?.live?.[0];
    if (!live) return 'agent.state';
    return `agent.state running=${live.isRunning} composing=${live.isComposingMessage}`;
  }
  return event.type;
}

async function pump(iterator, queue) {
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        queue.close();
        return;
      }
      queue.push(next.value);
    }
  } catch (error) {
    queue.close(error);
  }
}

function replyTimeoutMessage(account, bot, messageId) {
  return `Timed out waiting for the reply. The message was sent. Continue with: grok-bot wait --bot ${account}:${bot.id} --message-id ${messageId}`;
}

function invalidatesStatus(event, userText) {
  const user = String(userText ?? '').trim();
  if (event?.type === 'agent.state') {
    const live = Array.isArray(event.data?.live) ? event.data.live : [];
    return live.some(row => row?.isRunning === true || row?.isComposingMessage === true || row?.isRetrying === true || row?.hasRunningSubagents === true);
  }
  if (event?.type === 'message') {
    if (event.data?.replay === true) return false;
    const text = event.data?.text;
    return typeof text === 'string' && text.trim() && text.trim() !== user;
  }
  if (event?.type === 'entry') {
    if (event.data?.replay === true) return false;
    const entry = event.data?.entry;
    if (!entry || typeof entry !== 'object') return false;
    const kind = String(entry.kind || event.data?.entryKind || '').toLowerCase();
    if (kind !== 'message' && !kind.includes('send-message')) return false;
    if (entry.role === 'user' || entry.message?.role === 'user') return false;
    const text = typeof entry.content === 'string'
      ? entry.content
      : typeof entry.message?.content === 'string'
        ? entry.message.content
        : '';
    return Boolean(text.trim()) && text.trim() !== user;
  }
  return false;
}

async function waitForReply(ctx, client, bot, flags, onSent) {
  const timeoutMs = (flags.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const idleMs = (flags.idleTimeout ?? DEFAULT_IDLE_SEC) * 1000;
  const sessionId = flags.session ?? '';
  const sending = flags.sending !== false;
  const userText = flags.userText ?? flags.text ?? '';
  const abort = new AbortController();
  const iterator = client.watchBot({ botId: bot.id, sessionId, signal: abort.signal })[Symbol.asyncIterator]();
  const queue = createQueue();
  const pumping = pump(iterator, queue);
  const deadline = ctx.now() + timeoutMs;
  const buffered = [];
  let sent = null;
  const stop = () => {
    abort.abort();
    queue.cancel();
  };
  const unregister = onShutdown(stop);
  try {
    let connected = false;
    while (!connected) {
      const remaining = deadline - ctx.now();
      if (remaining <= 0) throw new CliError('STREAM_CONNECTION_FAILED', 'Timed out waiting for the bot event stream.', 4, { sent: false });
      const item = await queue.next(remaining);
      if (item.error) throw item.error;
      if (item.done) throw new CliError('STREAM_CONNECTION_FAILED', 'The bot event stream closed before it connected.', 4, { sent: false });
      if (item.timeout) continue;
      buffered.push(item.value);
      if (item.value?.type === 'connected') connected = true;
    }
    if (!sending && flags.recheck) {
      const transcript = await client.listTranscript({ botId: bot.id, sessionId, limit: WAIT_TRANSCRIPT_LIMIT });
      const found = findReplyAfterMessage(transcript.entries, flags.messageId, { echoEntryId: flags.echoEntryId ?? null });
      if (found.complete) return { sent: null, decision: { ok: true, text: found.text, reason: 'transcript' } };
    }
    if (sending) {
      const attachments = await attachmentArgs(flags.file ?? []);
      sent = await client.sendMessage({
        botId: bot.id,
        text: flags.text,
        sessionId,
        ...attachments,
      });
      onSent?.(sent);
    }
    const waiter = createTurnWait({
      timeoutMs,
      idleMs,
      userText,
      startedAt: ctx.now(),
      probeIntervalMs: STATUS_PROBE_INTERVAL_MS,
    });
    const accept = (decision) => {
      if (!decision?.done) return null;
      if (!decision.ok) {
        const code = decision.reason === 'timeout' ? 'TIMEOUT' : decision.reason === 'turn-failed' ? 'TURN_FAILED' : 'STREAM_CLOSED';
        const exitCode = decision.reason === 'timeout' ? 5 : 4;
        const message = decision.reason === 'turn-failed'
          ? `The turn failed${decision.summary ? `: ${decision.summary}` : '.'}`
          : decision.reason === 'timeout'
            ? (sent ? replyTimeoutMessage(flags.account ?? ctx.account, bot, sent.messageId) : 'Timed out waiting for the reply.')
            : 'The event stream closed before a reply.';
        throw new CliError(code, message, exitCode, {
          text: decision.text,
          endedBy: decision.reason,
          botId: bot.id,
          account: flags.account ?? ctx.account,
          ...sent ? { messageId: sent.messageId, sent: true } : { sent: false },
        });
      }
      return decision;
    };
    const fold = (events) => {
      for (const event of events) waiter.push(event, ctx.now());
      for (const extra of queue.drain()) waiter.push(extra, ctx.now());
    };
    // Frames already sitting in the watch body are still one read apart. Drain
    // those before a status call so a busy→idle pair in the same response stays agent-idle.
    async function catchUp() {
      let empty = 0;
      for (let i = 0; i < 40 && empty < 8; i += 1) {
        const extra = queue.drain();
        if (extra.length) {
          for (const event of extra) waiter.push(event, ctx.now());
          empty = 0;
        } else {
          empty += 1;
          await Promise.resolve();
        }
      }
    }
    async function resolveDecision(decision) {
      let current = decision;
      let spins = 0;
      while (current?.probe) {
        spins += 1;
        if (spins > 8) {
          current = waiter.forceTimeout();
          break;
        }
        await catchUp();
        current = waiter.poll(ctx.now());
        if (!current?.probe) break;
        const final = current.final === true;
        let running = true;
        let failed = false;
        try {
          const statuses = await client.listAgentStatuses([bot.id]);
          running = agentIsRunning(statuses.statuses, bot.id);
        } catch (error) {
          if (isUnauthorized(error)) throw error;
          failed = true;
        }
        const now = ctx.now();
        const during = queue.drain();
        let stale = false;
        let early = null;
        for (const event of during) {
          if (invalidatesStatus(event, userText)) stale = true;
          const pushed = waiter.push(event, now);
          if (pushed?.done && !pushed.ok) early = pushed;
          else if (pushed?.done && pushed.ok && !early) early = pushed;
        }
        if (early?.done) {
          current = early;
          break;
        }
        current = waiter.noteStatus(running, now, { final, failed: failed || stale });
      }
      return current;
    }
    fold(buffered);
    while (true) {
      const ready = accept(await resolveDecision(waiter.poll(ctx.now())));
      if (ready) return { sent, decision: ready };
      const remaining = deadline - ctx.now();
      if (remaining <= 0) {
        let finished = await resolveDecision(waiter.finish('timeout', ctx.now()));
        if (!finished?.done) finished = waiter.forceTimeout();
        return { sent, decision: accept(finished) };
      }
      const waitMs = Math.min(remaining, waiter.nextWait(ctx.now()));
      const item = await queue.next(Math.max(0, waitMs));
      if (item.error) throw item.error;
      if (item.done) {
        let finished = await resolveDecision(waiter.finish('stream-closed', ctx.now()));
        if (!finished?.done) finished = waiter.forceClosed();
        return { sent, decision: accept(finished) };
      }
      if (item.value) fold([item.value]);
    }
  } finally {
    unregister();
    stop();
    // iterator.return() stays pending until the current body read settles. Abort
    // cancels a real fetch body; a stream that ignores the signal must not pin the process.
    const closing = (async () => {
      await iterator.return?.().catch(() => {});
      await pumping.catch(() => {});
    })();
    closing.catch(() => {});
    await Promise.race([closing, delay(100)]);
  }
}

function attachSent(error, sent) {
  const normalized = asCliError(error);
  return new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
    ...normalized.extra,
    sent: normalized.extra?.sent ?? sent,
  });
}

async function commandSend(ctx, flags) {
  let committed = false;
  try {
    const resolved = await resolveBot(ctx, flags.bot);
    return await withAccount(ctx, resolved.account, async (client) => {
      if (committed) {
        throw new CliError('WATCH_AFTER_SEND_FAILED', 'The message was sent, but waiting for the reply failed.', 4, {
          sent: true,
          account: resolved.account,
          botId: resolved.bot.id,
        });
      }
      const sessionId = flags.session ?? '';
      if (!flags.wait) {
        const attachments = await attachmentArgs(flags.file);
        const sent = await client.sendMessage({ botId: resolved.bot.id, text: flags.text, sessionId, ...attachments });
        committed = true;
        return ok(ctx, {
          account: resolved.account,
          botId: sent.botId,
          messageId: sent.messageId,
          delivery: sent.delivery,
          dispatched: sent.dispatched,
        }, `sent ${sent.botId} ${sent.messageId} ${sent.delivery}`);
      }
      const { sent, decision } = await waitForReply(ctx, client, resolved.bot, {
        text: flags.text,
        timeout: flags.timeout,
        idleTimeout: flags.idleTimeout,
        session: sessionId,
        file: flags.file,
        account: resolved.account,
      }, () => { committed = true; });
      if (!ctx.json) ctx.stderr.write(`endedBy ${decision.reason}\n`);
      return ok(ctx, {
        account: resolved.account,
        botId: sent.botId,
        messageId: sent.messageId,
        delivery: sent.delivery,
        dispatched: sent.dispatched,
        text: decision.text,
        endedBy: decision.reason,
      }, decision.text);
    });
  } catch (error) {
    throw attachSent(error, committed);
  }
}

async function commandWait(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const sessionId = flags.session ?? '';
    let echoEntryId = null;
    try {
      const status = await client.getSendStatus({ botId: resolved.bot.id, messageId: flags.messageId, sessionId });
      echoEntryId = status.echoEntryId;
    } catch (error) {
      if (isUnauthorized(error)) throw error;
      const normalized = asCliError(error);
      if (normalized.exitCode === 3) throw normalized;
    }
    const transcript = await client.listTranscript({ botId: resolved.bot.id, sessionId, limit: WAIT_TRANSCRIPT_LIMIT });
    const found = findReplyAfterMessage(transcript.entries, flags.messageId, { echoEntryId });
    if (found.complete) {
      if (!ctx.json) ctx.stderr.write('endedBy transcript\n');
      return ok(ctx, {
        account: resolved.account,
        botId: resolved.bot.id,
        messageId: flags.messageId,
        text: found.text,
        endedBy: 'transcript',
      }, found.text);
    }
    const { decision } = await waitForReply(ctx, client, resolved.bot, {
      sending: false,
      recheck: true,
      messageId: flags.messageId,
      echoEntryId,
      userText: found.anchorText,
      timeout: flags.timeout,
      idleTimeout: flags.idleTimeout,
      session: sessionId,
      account: resolved.account,
    });
    if (!ctx.json) ctx.stderr.write(`endedBy ${decision.reason}\n`);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      messageId: flags.messageId,
      text: decision.text,
      endedBy: decision.reason,
    }, decision.text);
  });
}

async function commandRelay(ctx, flags) {
  try {
    const from = await resolveBot(ctx, flags.from);
    const to = await resolveBot(ctx, flags.to);
    const template = flags.template ?? '{reply}';
    if (flags.dryRun) {
      return ok(ctx, {
        dryRun: true,
        from: { account: from.account, botId: from.bot.id, botName: from.bot.name },
        to: { account: to.account, botId: to.bot.id, botName: to.bot.name },
        text: flags.text,
        template,
      }, `from ${from.account}:${from.bot.name} (${from.bot.id})\nto ${to.account}:${to.bot.name} (${to.bot.id})\n${flags.text}`);
    }
    const rounds = flags.rounds ?? 1;
    const steps = [];
    const sequence = [];
    for (let round = 0; round < rounds; round += 1) sequence.push(from, to);
    let previous = null;
    for (let index = 0; index < sequence.length; index += 1) {
      const target = sequence[index];
      const text = index === 0 ? flags.text : renderTemplate(template, {
        reply: previous.text,
        fromName: previous.bot.name,
        fromAccount: previous.account,
      });
      let committed = false;
      try {
        const result = await withAccount(ctx, target.account, async (client) => {
          if (committed) {
            throw new CliError('WATCH_AFTER_SEND_FAILED', 'The message was sent, but waiting for the reply failed.', 4, { sent: true });
          }
          return waitForReply(ctx, client, target.bot, {
            text,
            timeout: flags.timeout,
            idleTimeout: flags.idleTimeout,
            session: '',
            file: [],
            account: target.account,
          }, () => { committed = true; });
        });
        const row = {
          step: index + 1,
          account: target.account,
          botId: target.bot.id,
          botName: target.bot.name,
          sent: true,
          messageId: result.sent.messageId,
          text: result.decision.text,
          endedBy: result.decision.reason,
        };
        steps.push(row);
        previous = { account: target.account, bot: target.bot, text: result.decision.text };
      } catch (error) {
        const normalized = asCliError(error);
        throw new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
          ...normalized.extra,
          sent: normalized.extra?.sent ?? committed,
          completedSteps: steps.slice(),
        });
      }
    }
    const lines = steps.map(step => `${step.step}\t${step.account}\t${step.botName}\n${step.text}`).join('\n');
    return ok(ctx, { steps }, lines);
  } catch (error) {
    const normalized = asCliError(error);
    throw new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
      ...normalized.extra,
      sent: normalized.extra?.sent ?? false,
      completedSteps: normalized.extra?.completedSteps ?? [],
    });
  }
}

async function commandWatch(ctx, flags) {
  const queries = flags.bots?.length ? flags.bots : [flags.bot];
  const resolved = [];
  for (const query of queries) resolved.push({ ...(await resolveBot(ctx, query)), query });
  const abort = new AbortController();
  const onSigint = () => abort.abort();
  process.on('SIGINT', onSigint);
  const unregister = onShutdown(() => abort.abort());
  let writeChain = Promise.resolve();
  const writeLine = (line) => {
    writeChain = writeChain.then(() => { ctx.stdout.write(line); });
    return writeChain;
  };
  try {
    await Promise.all(resolved.map(async (item) => {
      await withAccount(ctx, item.account, async (client) => {
        for await (const event of client.watchBot({ botId: item.bot.id, sessionId: flags.session ?? '', signal: abort.signal })) {
          if (ctx.json) await writeLine(`${JSON.stringify(redact({ ok: true, account: item.account, botId: item.bot.id, event: publicEvent(event) }))}\n`);
          else await writeLine(`${item.account}\t${item.bot.id}\t${formatEvent(event)}\n`);
        }
      });
    }));
    await writeChain;
    return 0;
  } catch (error) {
    abort.abort();
    throw error;
  } finally {
    unregister();
    process.off('SIGINT', onSigint);
    abort.abort();
  }
}

async function commandFiles(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentFiles({
      botId: resolved.bot.id,
      ...flags.pageToken != null ? { pageToken: flags.pageToken } : {},
    });
    const lines = result.files.map(file => `${file.path}\t${file.sizeBytes}\t${file.contentType}`).join('\n');
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      count: result.files.length,
      nextPageToken: result.nextPageToken,
      totalBytes: result.totalBytes,
      canEdit: result.canEdit,
      files: result.files,
    }, lines || '(no files)');
  });
}

async function commandInvites(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentAccessInvites(resolved.bot.id);
    const lines = result.invites.map(invite => invite.email).join('\n');
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      count: result.invites.length,
      invites: result.invites,
      capUsage: result.capUsage,
    }, lines || '(no invites)');
  });
}

async function commandBotCreate(ctx, flags) {
  return withAccount(ctx, ctx.account, async (client) => {
    const created = await client.createBot({
      name: flags.name,
      ...flags.description != null ? { description: flags.description } : {},
      ...flags.title != null ? { title: flags.title } : {},
    });
    return ok(ctx, {
      account: ctx.account,
      bot: managedBot(created.bot),
      harness: created.harness,
    }, `created ${created.bot.name} (${created.bot.id})`);
  });
}

async function commandBotUpdate(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  const serverId = requireServerId(resolved.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const updated = await client.updateBot({
      id: serverId,
      ...flags.name != null ? { name: flags.name } : {},
      ...flags.description != null ? { description: flags.description } : {},
      ...flags.title != null ? { title: flags.title } : {},
    });
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      serverId,
      bot: managedBot(updated.bot),
    }, `updated ${updated.bot.name} (${updated.bot.id})`);
  });
}

async function commandBotDuplicate(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const copied = await client.duplicateBot({ botId: resolved.bot.id });
    let bot = copied.bot;
    let renamed = false;
    if (flags.name != null) {
      if (typeof bot.serverId !== 'string' || !bot.serverId) {
        throw new CliError('USAGE', `The bot was copied (${bot.id}), but it has no server id, so it was not renamed.`, 3, {
          duplicated: true,
          botId: bot.id,
          account: resolved.account,
        });
      }
      try {
        const updated = await client.updateBot({ id: bot.serverId, name: flags.name });
        bot = updated.bot;
        renamed = true;
      } catch (error) {
        const normalized = asCliError(error);
        throw new CliError(normalized.code, `The bot was copied (${copied.bot.id}), but renaming it failed. ${normalized.message}`, normalized.exitCode ?? 4, {
          ...normalized.extra,
          duplicated: true,
          botId: copied.bot.id,
          serverId: copied.bot.serverId,
          account: resolved.account,
        });
      }
    }
    return ok(ctx, {
      account: resolved.account,
      sourceBotId: resolved.bot.id,
      renamed,
      bot: managedBot(bot),
    }, `copied ${bot.name} (${bot.id})`);
  });
}

async function commandBotDelete(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot, { exact: true });
  const fields = {
    account: resolved.account,
    botId: resolved.bot.id,
    botName: resolved.bot.name,
    kind: resolved.bot.kind ?? '',
  };
  if (!flags.yes) return dryRun(ctx, 'bot delete', fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.deleteBot(resolved.bot.id);
    return ok(ctx, { ...fields, id: result.id, deleted: true }, `deleted ${fields.botName} (${result.id})`);
  });
}

async function commandBot(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === 'create') return commandBotCreate(ctx, flags);
  if (sub === 'update') return commandBotUpdate(ctx, flags);
  if (sub === 'duplicate') return commandBotDuplicate(ctx, flags);
  if (sub === 'delete') return commandBotDelete(ctx, flags);
  throw new CliError('USAGE', `Unknown bot command "${sub ?? ''}".`, 3);
}

async function commandRoomCreate(ctx, flags) {
  const scoped = ctx.accountExplicit ? ctx.account : null;
  const members = await resolveMembers(ctx, flags.members, { account: scoped });
  const account = scoped || members[0].account;
  return withAccount(ctx, account, async (client) => {
    const created = await client.createRoom({
      name: flags.name,
      memberAgentIds: members.map(member => member.bot.id),
      ...flags.description != null ? { description: flags.description } : {},
    });
    return ok(ctx, {
      account,
      bot: managedBot(created.bot),
      members: members.map(member => ({ account: member.account, id: member.bot.id, name: member.bot.name })),
    }, `created room ${created.bot.name} (${created.bot.id})`);
  });
}

async function commandRoomAddMember(ctx, flags) {
  return withBot(ctx, flags.room, async (client, _session, resolved) => {
    const result = await client.addRoomMembers({ roomId: resolved.bot.id, userIds: flags.userIds });
    return ok(ctx, {
      account: resolved.account,
      roomId: resolved.bot.id,
      userIds: flags.userIds,
      bot: managedBot(result.bot),
    }, `added ${flags.userIds.join(',')} to ${resolved.bot.name}`);
  }, { requireRoom: true });
}

async function commandRoomDelete(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? '',
  };
  if (!flags.yes) return dryRun(ctx, 'room delete', fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.deleteRoom(resolved.bot.id);
    return ok(ctx, { ...fields, id: result.id, deleted: true }, `deleted room ${fields.roomName} (${result.id})`);
  });
}

async function commandRoomRemoveMember(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? '',
    userIds: flags.userIds,
  };
  if (!flags.yes) return dryRun(ctx, 'room remove-member', fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.removeRoomMembers({ roomId: resolved.bot.id, userIds: flags.userIds });
    return ok(ctx, {
      ...fields,
      removed: true,
      bot: result.bot ? managedBot(result.bot) : null,
    }, `removed members from ${fields.roomName}`);
  });
}

async function commandRoomSetMembers(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const members = await resolveMembers(ctx, flags.members, { exact: true, account: resolved.account });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? '',
    members: members.map(member => ({ id: member.bot.id, name: member.bot.name })),
  };
  if (!flags.yes) return dryRun(ctx, 'room set-members', fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.setRoomMembers({
      roomId: resolved.bot.id,
      memberAgentIds: members.map(member => member.bot.id),
    });
    return ok(ctx, { ...fields, bot: managedBot(result.bot) }, `set members on ${fields.roomName}`);
  });
}

async function commandRoom(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === 'create') return commandRoomCreate(ctx, flags);
  if (sub === 'add-member') return commandRoomAddMember(ctx, flags);
  if (sub === 'delete') return commandRoomDelete(ctx, flags);
  if (sub === 'remove-member') return commandRoomRemoveMember(ctx, flags);
  if (sub === 'set-members') return commandRoomSetMembers(ctx, flags);
  throw new CliError('USAGE', `Unknown room command "${sub ?? ''}".`, 3);
}

async function commandSkillWrite(ctx, flags, mode) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const content = await readSkillContent(flags);
    const input = {
      botId: resolved.bot.id,
      name: flags.name,
      content,
      ...flags.description != null ? { description: flags.description } : {},
    };
    const result = mode === 'add' ? await client.addAgentSkill(input) : await client.updateAgentSkill(input);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      name: flags.name,
      skill: publicSkill(result.skill),
    }, `${mode === 'add' ? 'added' : 'updated'} skill ${flags.name}`);
  });
}

async function commandSkillRemove(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot, { exact: true });
  const fields = {
    account: resolved.account,
    botId: resolved.bot.id,
    botName: resolved.bot.name,
    kind: resolved.bot.kind ?? '',
    name: flags.name,
  };
  if (!flags.yes) return dryRun(ctx, 'skill remove', fields);
  return withAccount(ctx, resolved.account, async (client) => {
    await client.removeAgentSkill({ botId: resolved.bot.id, name: flags.name });
    return ok(ctx, { ...fields, removed: true }, `removed skill ${flags.name}`);
  });
}

async function commandSkill(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === 'add') return commandSkillWrite(ctx, flags, 'add');
  if (sub === 'update') return commandSkillWrite(ctx, flags, 'update');
  if (sub === 'remove') return commandSkillRemove(ctx, flags);
  throw new CliError('USAGE', `Unknown skill command "${sub ?? ''}".`, 3);
}

function printHelp(ctx) {
  if (ctx.json) writeJson(ctx, { ok: true, help: HELP });
  else ctx.stdout.write(HELP.endsWith('\n') ? HELP : `${HELP}\n`);
  return 0;
}

function printVersion(ctx) {
  const runtime = ctx.runtime;
  return ok(ctx, {
    version: CLI_VERSION,
    targetVersion: TARGET_VERSION,
    runtime: runtime.name,
    runtimeVersion: formatRuntimeVersion(runtime.version),
  }, `grok-bot ${CLI_VERSION}\ngrok-bot-target ${TARGET_VERSION}\n${formatRuntimeLine(runtime)}`);
}

async function dispatch(ctx, flags) {
  switch (flags.command) {
    case 'login': return commandLogin(ctx, flags);
    case 'logout': return commandLogout(ctx);
    case 'status': return commandStatus(ctx, flags);
    case 'accounts': return commandAccounts(ctx, flags);
    case 'bots': return commandBots(ctx, flags);
    case 'sessions': return commandSessions(ctx, flags);
    case 'transcript': return commandTranscript(ctx, flags);
    case 'tasks': return commandTasks(ctx, flags);
    case 'todos': return commandTodos(ctx, flags);
    case 'skills': return commandSkills(ctx, flags);
    case 'capabilities': return commandCapabilities(ctx);
    case 'box': return commandBox(ctx);
    case 'send': return commandSend(ctx, flags);
    case 'wait': return commandWait(ctx, flags);
    case 'relay': return commandRelay(ctx, flags);
    case 'watch': return commandWatch(ctx, flags);
    case 'files': return commandFiles(ctx, flags);
    case 'invites': return commandInvites(ctx, flags);
    case 'bot': return commandBot(ctx, flags);
    case 'room': return commandRoom(ctx, flags);
    case 'skill': return commandSkill(ctx, flags);
    default: throw new CliError('USAGE', `Unknown command "${flags.command}". Run: grok-bot --help`, 3);
  }
}

export async function runCli(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const parsed = parseArgs(options.argv ?? []);
  const directory = configDir({
    platform: options.platform ?? process.platform,
    env,
    homedir: options.homedir ?? homedir(),
  });
  const ctx = {
    stdout,
    stderr,
    env,
    json: parsed.json,
    profile: parsed.profile || parsed.account || 'default',
    account: parsed.profile || parsed.account || 'default',
    accountExplicit: Boolean(parsed.profile || parsed.account),
    noOpen: parsed.noOpen,
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    now: options.now ?? Date.now,
    sleep: options.sleep ?? delay,
    openBrowser: options.openBrowser ?? (url => defaultOpen(url, options.platform ?? process.platform)),
    configDirectory: directory,
    credentialFile: credentialPath(directory, parsed.profile || parsed.account || 'default'),
    pendingFile: pendingPath(directory, parsed.profile || parsed.account || 'default'),
    runtime: options.runtime ?? detectRuntime(),
  };
  try {
    const runtimeMessage = unsupportedRuntime(ctx.runtime);
    if (runtimeMessage) return fail(ctx, new CliError('RUNTIME_UNSUPPORTED', runtimeMessage, 3));
    if (!parsed.ok) return fail(ctx, new CliError('USAGE', parsed.errors[0], 3));
    if (parsed.help || parsed.command === 'help') return printHelp(ctx);
    if (parsed.version || parsed.command === 'version') return printVersion(ctx);
    if (!parsed.command) return fail(ctx, new CliError('USAGE', 'Missing command. Run: grok-bot --help', 3));
    if (!COMMAND_NAMES.has(parsed.command)) return fail(ctx, new CliError('USAGE', `Unknown command "${parsed.command}". Run: grok-bot --help`, 3));
    const commandErrors = validateCommand(parsed);
    if (commandErrors.length) return fail(ctx, new CliError('USAGE', commandErrors[0], 3));
    const registry = await registryOf(ctx);
    if (!ctx.accountExplicit) bindAccount(ctx, registry.default || 'default');
    else bindAccount(ctx, parsed.account || parsed.profile);
    ctx.accountExplicit = Boolean(parsed.account || parsed.profile);
    return await dispatch(ctx, parsed);
  } catch (error) {
    return fail(ctx, normalizeError(error));
  }
}

export { configDir, createTurnWait, matchBot, parseArgs, publicSession };
