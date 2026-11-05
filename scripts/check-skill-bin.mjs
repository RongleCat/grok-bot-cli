#!/usr/bin/env node
// Fail when skills/grok-bot/bin is not a byte-for-byte copy of dist/.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = 'grok-bot.mjs';

async function load(dir) {
  const file = path.join(root, dir, name);
  const bytes = await readFile(file);
  const sums = await readFile(path.join(root, dir, 'SHA256SUMS'), 'utf8');
  return { bytes, sums };
}

const dist = await load('dist');
const skill = await load(path.join('skills', 'grok-bot', 'bin'));
const hash = createHash('sha256').update(dist.bytes).digest('hex');
const expected = `${hash}  ${name}\n`;

if (!dist.bytes.equals(skill.bytes)) {
  process.stderr.write('skills/grok-bot/bin/grok-bot.mjs does not match dist/grok-bot.mjs\n');
  process.exit(1);
}
if (dist.sums !== expected || skill.sums !== expected) {
  process.stderr.write(`SHA256SUMS does not match ${name}\n`);
  process.stderr.write(`expected ${JSON.stringify(expected)}\n`);
  process.stderr.write(`dist     ${JSON.stringify(dist.sums)}\n`);
  process.stderr.write(`skill    ${JSON.stringify(skill.sums)}\n`);
  process.exit(1);
}
process.stdout.write(`ok ${hash}\n`);
