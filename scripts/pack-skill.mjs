#!/usr/bin/env node
// Pack skills/grok-bot into tiezhu-grok-bot-skill.zip.
// The zip root is grok-bot/. .DS_Store is excluded.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(root, process.argv[2] || 'release');
const zipName = 'tiezhu-grok-bot-skill.zip';
const zipPath = path.join(outDir, zipName);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: path.join(root, 'skills'), encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

await mkdir(outDir, { recursive: true });
await rm(zipPath, { force: true });
run('zip', ['-r', '-X', zipPath, 'grok-bot', '-x', '*.DS_Store', '-x', '*/.DS_Store']);

const names = run('unzip', ['-Z1', zipPath]).split(/\r?\n/).filter(Boolean);
const bad = names.filter((name) => name.split('/').includes('.DS_Store') || (!name.startsWith('grok-bot/') && name !== 'grok-bot'));
if (bad.length || !names.some((name) => name === 'grok-bot/SKILL.md' || name.endsWith('/SKILL.md'))) {
  throw new Error(`unexpected zip entries:\n${names.join('\n')}`);
}

const bytes = await readFile(zipPath);
const hash = createHash('sha256').update(bytes).digest('hex');
const sums = `${hash}  ${zipName}\n`;
await writeFile(path.join(outDir, 'SHA256SUMS.txt'), sums);
process.stdout.write(`${sums}${names.length} entries\n`);
