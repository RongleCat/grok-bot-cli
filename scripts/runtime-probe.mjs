import { execFile } from 'node:child_process';
import { createDecipheriv, createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'grok-bot-probe-'));
const file = join(dir, 'secret.json');
await writeFile(file, '{}\n', { mode: 0o600 });
await chmod(file, 0o600);
const mode = (await stat(file)).mode & 0o777;
await rm(dir, { recursive: true, force: true });

const hash = createHash('sha256').update('grok-bot').digest('base64url');
const id = randomUUID();
const key = pbkdf2Sync('pw', 'saltysalt', 1003, 16, 'sha1');
let decipher = 'missing';
try {
  const algo = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32));
  algo.update(randomBytes(16));
  algo.final();
  decipher = 'ok';
} catch {
  decipher = 'available';
}
key.fill(0);

let execFileTrue = 'skipped';
if (process.platform !== 'win32') {
  await execFileAsync('/usr/bin/true', []);
  execFileTrue = 'ok';
}

process.stdout.write(`${JSON.stringify({
  argv: process.argv,
  execPath: process.execPath,
  versions: { node: process.versions.node ?? null, bun: process.versions.bun ?? null },
  mode,
  hashLength: hash.length,
  uuid: typeof id === 'string' && id.includes('-'),
  pbkdf2Length: key.length,
  decipher,
  execFileTrue,
})}\n`);
