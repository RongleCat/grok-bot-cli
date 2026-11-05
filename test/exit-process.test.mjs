import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN = join(CLI_ROOT, 'src', 'main.mjs');
const PRELOAD = join(CLI_ROOT, 'test', 'exit-preload.mjs');

async function bunExecutable() {
  const prefixes = [process.env.BUN_INSTALL, join(homedir(), '.bun')].filter(Boolean);
  for (const prefix of prefixes) {
    const candidate = join(prefix, 'bin', 'bun');
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next install prefix, then PATH.
    }
  }
  return 'bun';
}

function spawnCollected(command, args, { env, stdout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', stdout ?? 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    if (stdout == null || stdout === 'pipe') child.stdout?.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hung ${command} ${args.join(' ')}\n${Buffer.concat(err).toString('utf8')}`));
    }, 20000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

function childEnv(dir, fixture) {
  return {
    ...process.env,
    GROK_BOT_CONFIG_DIR: dir,
    GROK_BOT_ACCESS_TOKEN: 'fixture-access-token',
    ...fixture ? { GROK_BOT_EXIT_FIXTURE: fixture } : { GROK_BOT_EXIT_FIXTURE: '' },
  };
}

function runtimeArgs(runtime, { preload, args }) {
  const prefix = preload
    ? (runtime.name === 'bun' ? ['--preload', PRELOAD] : ['--import', pathToFileURL(PRELOAD).href])
    : [];
  return [...prefix, MAIN, ...args];
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'grok-bot-exit-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('main does not call process.exit, and the exit helper is the only fallback', async () => {
  const mainSource = await readFile(MAIN, 'utf8');
  const exitSource = await readFile(join(CLI_ROOT, 'src', 'exit.mjs'), 'utf8');
  assert.equal(mainSource.includes('process.exit'), false);
  assert.match(exitSource, /process\.exitCode/);
  assert.match(exitSource, /nodejs\/node#56645/);
  assert.match(exitSource, /nodejs\/node#64322/);
  assert.match(exitSource, /\.unref\?\.\(\)/);
});

test('a child process keeps exit code 5 and a large JSON document on a pipe and a file', async () => {
  const bun = await bunExecutable();
  const runtimes = [
    { name: 'node', command: process.execPath },
    { name: 'bun', command: bun },
  ];
  await withDir(async (dir) => {
    for (const runtime of runtimes) {
      const version = await spawnCollected(runtime.command, runtimeArgs(runtime, { preload: false, args: ['--version'] }), {
        env: childEnv(dir),
      });
      assert.equal(version.code, 0, `${runtime.name} version stderr=${version.stderr}`);
      assert.match(version.stdout, /grok-bot 0\.3\.0/);

      const usage = await spawnCollected(runtime.command, runtimeArgs(runtime, { preload: false, args: ['--json'] }), {
        env: childEnv(dir),
      });
      assert.equal(usage.code, 3, `${runtime.name} usage stderr=${usage.stderr}`);
      assert.equal(JSON.parse(usage.stdout).error.code, 'USAGE');
      assert.equal(JSON.parse(usage.stdout).error.exitCode, 3);

      const piped = await spawnCollected(runtime.command, runtimeArgs(runtime, {
        preload: true,
        args: ['transcript', '--bot', 'alpha', '--limit', '500', '--json'],
      }), { env: childEnv(dir, 'transcript') });
      assert.equal(piped.code, 0, `${runtime.name} pipe stderr=${piped.stderr}`);
      assert.equal(piped.stderr.includes('Assertion failed'), false);
      assert.equal(piped.stdout.endsWith('\n'), true);
      const pipedBody = JSON.parse(piped.stdout);
      assert.equal(pipedBody.count, 500);
      assert.equal(pipedBody.entries.length, 500);
      assert.equal(pipedBody.entries[499].text.startsWith('line-499-'), true);

      const filePath = join(dir, `${runtime.name}-transcript.json`);
      const fd = openSync(filePath, 'w');
      let filed;
      try {
        filed = await spawnCollected(runtime.command, runtimeArgs(runtime, {
          preload: true,
          args: ['transcript', '--bot', 'alpha', '--limit', '500', '--json'],
        }), { env: childEnv(dir, 'transcript'), stdout: fd });
      } finally {
        closeSync(fd);
      }
      assert.equal(filed.code, 0, `${runtime.name} file stderr=${filed.stderr}`);
      const filedText = await readFile(filePath, 'utf8');
      assert.equal(filedText, piped.stdout);
      const filedBody = JSON.parse(filedText);
      assert.equal(filedBody.count, 500);
      assert.equal(filedBody.entries.at(-1).text.startsWith('line-499-'), true);

      const timed = await spawnCollected(runtime.command, runtimeArgs(runtime, {
        preload: true,
        args: ['send', '--bot', 'alpha', '--text', 'ping', '--wait', '--idle-timeout', '0', '--timeout', '1', '--json'],
      }), { env: childEnv(dir, 'timeout') });
      assert.equal(timed.code, 5, `${runtime.name} timeout stdout=${timed.stdout}\nstderr=${timed.stderr}`);
      assert.equal(timed.stderr.includes('Assertion failed'), false);
      const error = JSON.parse(timed.stdout).error;
      assert.equal(error.code, 'TIMEOUT');
      assert.equal(error.exitCode, 5);
      assert.equal(error.sent, true);
      assert.equal(typeof error.messageId, 'string');
      assert.ok(error.messageId);
      assert.match(error.text, /正在查/);
      assert.match(error.message, /wait --bot default:bot-alpha --message-id /);
    }
  });
});
