import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.mjs';
import { readJsonFile } from './config.mjs';

export const ALIAS = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function accountsPath(dir) {
  return path.join(dir, 'accounts.json');
}

export function maskEmail(email) {
  if (typeof email !== 'string') return '';
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return '';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain || /\s/.test(local) || /\s/.test(domain)) return '';
  return `${local.slice(0, 2)}***@${domain}`;
}

// Hash only. The auth id and user id are not written to disk.
export function identityHash(me) {
  const authId = typeof me?.authId === 'string' ? me.authId.trim() : '';
  const userId = typeof me?.userId === 'string' ? me.userId.trim() : '';
  const key = authId ? `authId:${authId}` : userId ? `userId:${userId}` : '';
  if (!key) return '';
  return createHash('sha256').update(key).digest('hex');
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.alias !== 'string' || !ALIAS.test(raw.alias)) return null;
  const identity = typeof raw.identityHash === 'string' && /^[a-f0-9]{64}$/.test(raw.identityHash) ? raw.identityHash : '';
  const addedAt = typeof raw.addedAt === 'string' && raw.addedAt ? raw.addedAt : '';
  const lastUsedAt = typeof raw.lastUsedAt === 'string' && raw.lastUsedAt ? raw.lastUsedAt : addedAt;
  if (!addedAt || !lastUsedAt) return null;
  return {
    alias: raw.alias,
    label: typeof raw.label === 'string' ? raw.label : '',
    addedAt,
    lastUsedAt,
    identityHash: identity,
  };
}

function parseRegistry(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.version !== 1) return null;
  if (typeof parsed.default !== 'string' || !ALIAS.test(parsed.default)) return null;
  if (!Array.isArray(parsed.accounts)) return null;
  const accounts = [];
  const seen = new Set();
  for (const raw of parsed.accounts) {
    const row = normalizeRecord(raw);
    if (!row || seen.has(row.alias)) return null;
    seen.add(row.alias);
    accounts.push(row);
  }
  return { version: 1, default: parsed.default, accounts };
}

export function serializeRegistry(registry) {
  return {
    version: 1,
    default: registry.default,
    accounts: registry.accounts.map((row) => {
      const out = {
        alias: row.alias,
        label: row.label ?? '',
        addedAt: row.addedAt,
        lastUsedAt: row.lastUsedAt,
      };
      if (row.identityHash) out.identityHash = row.identityHash;
      return out;
    }),
  };
}

export async function writeRegistry(dir, registry) {
  const file = accountsPath(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try { await chmod(dir, 0o700); } catch { /* Windows ACLs are best-effort. */ }
  const tmp = path.join(dir, `.accounts.json.${process.pid}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(serializeRegistry(registry))}\n`, { mode: 0o600, flag: 'w' });
    try { await chmod(tmp, 0o600); } catch { /* Windows ACLs are best-effort. */ }
    await rename(tmp, file);
    try { await chmod(file, 0o600); } catch { /* Windows ACLs are best-effort. */ }
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

export async function listProfileNames(dir) {
  let names;
  try {
    names = await readdir(path.join(dir, 'profiles'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter(name => name.endsWith('.json') && !name.endsWith('.pending.json'))
    .map(name => name.slice(0, -'.json'.length))
    .filter(name => ALIAS.test(name))
    .sort((left, right) => left.localeCompare(right));
}

export async function loadOrMigrate(dir, nowIso) {
  const parsed = await readJsonFile(accountsPath(dir));
  if (parsed === null) throw new CliError('ACCOUNTS_INVALID', 'accounts.json is not valid JSON.', 3);
  if (parsed !== undefined) {
    const registry = parseRegistry(parsed);
    if (!registry) throw new CliError('ACCOUNTS_INVALID', 'accounts.json has an unsupported shape.', 3);
    return { ...registry, persisted: true };
  }
  const profiles = await listProfileNames(dir);
  if (profiles.length === 0) {
    return { version: 1, default: 'default', accounts: [], persisted: false };
  }
  const registry = {
    version: 1,
    default: 'default',
    accounts: profiles.map(alias => ({
      alias,
      label: '',
      addedAt: nowIso,
      lastUsedAt: nowIso,
      identityHash: '',
    })),
    persisted: true,
  };
  await writeRegistry(dir, registry);
  return registry;
}
