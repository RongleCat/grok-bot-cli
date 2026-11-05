#!/usr/bin/env node
// Print the CHANGELOG section for a tag (v0.78.1 or 0.78.1) to stdout.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = String(process.argv[2] ?? '').replace(/^refs\/tags\//, '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  process.stderr.write('Pass a version tag such as v0.78.1\n');
  process.exit(1);
}

const text = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
const lines = text.split(/\r?\n/);
const heading = new RegExp(`^## \\[?${version}\\]?\\b`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) {
  process.stderr.write(`CHANGELOG.md has no section for ${version}\n`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
if (end < 0) end = lines.length;
process.stdout.write(`${lines.slice(start, end).join('\n').trim()}\n`);
