import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.mjs';

function pathsFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function configDir({ platform, env, homedir }) {
  const { join } = pathsFor(platform);
  if (env.GROK_BOT_CONFIG_DIR) return env.GROK_BOT_CONFIG_DIR;
  if (platform === 'darwin') return join(homedir, 'Library', 'Application Support', 'grok-bot-cli');
  if (platform === 'win32') return join(env.APPDATA || join(homedir, 'AppData', 'Roaming'), 'grok-bot-cli');
  return join(env.XDG_CONFIG_HOME || join(homedir, '.config'), 'grok-bot-cli');
}

export function credentialPath(dir, profile) {
  return path.join(dir, 'profiles', `${profile}.json`);
}

export function pendingPath(dir, profile) {
  return path.join(dir, 'profiles', `${profile}.pending.json`);
}

export async function writeSecret(file, text) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try { await chmod(dir, 0o700); } catch { /* Windows ACLs are best-effort. */ }
  await writeFile(file, text, { mode: 0o600, flag: 'w' });
  try { await chmod(file, 0o600); } catch { /* Windows ACLs are best-effort. */ }
}

export async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    return null;
  }
}

export async function removeFile(file) {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function loadStoredSession(file) {
  const parsed = await readJsonFile(file);
  if (parsed === undefined) return null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('CREDENTIALS_INVALID', 'The credential file is not valid JSON.', 2);
  }
  if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) {
    throw new CliError('CREDENTIALS_INVALID', 'The credential file has no access token.', 2);
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === 'string' && parsed.refreshToken ? parsed.refreshToken : null,
    teamId: Number.isInteger(parsed.selectedTeamId) ? parsed.selectedTeamId : undefined,
    source: 'file',
    path: file,
    refreshed: false,
  };
}

export function publicSession(session) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    ...session.teamId !== undefined ? { selectedTeamId: session.teamId } : {},
  };
}
