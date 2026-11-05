#!/usr/bin/env node
// Bundle src and the grok-bot-sdk package into one dependency-free ESM file.
// The shipped file is not minified. A minified build is measured and discarded.
// The same bytes are copied to skills/grok-bot/bin for the agent skill.

import { createHash } from 'node:crypto';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(CLI_ROOT, 'dist');
const SKILL_BIN = path.join(CLI_ROOT, 'skills', 'grok-bot', 'bin');
const ENTRY = path.join(CLI_ROOT, 'src', 'main.mjs');
const OUT_NAME = 'grok-bot.mjs';
const SHEBANG = '#!/usr/bin/env node\n';

const ALLOWED = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

function specifiers(source) {
  const found = [];
  // Require whitespace so a quoted flag such as 'from' is not treated as an import.
  const pattern = /(?:^|[^.\w])from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

function withOneShebang(text) {
  let rest = text;
  while (rest.startsWith('#!')) {
    const nl = rest.indexOf('\n');
    rest = nl === -1 ? '' : rest.slice(nl + 1);
  }
  return `${SHEBANG}${rest.replace(/^\n+/, '')}`;
}

async function bundle(minify) {
  const result = await esbuild.build({
    absWorkingDir: CLI_ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify,
    legalComments: 'none',
    banner: { js: SHEBANG },
    write: false,
    logLevel: 'silent',
  });
  const file = result.outputFiles?.[0];
  if (!file) throw new Error('esbuild produced no output');
  // main.mjs already starts with a shebang, and the banner adds another.
  // Node and Bun only ignore the first line.
  return withOneShebang(file.text);
}

function sizes(text) {
  const bytes = Buffer.from(text);
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

async function main() {
  const plain = await bundle(false);
  const mini = await bundle(true);
  if (!plain.startsWith(SHEBANG)) throw new Error('bundle is missing the node shebang');
  const external = specifiers(plain).filter(specifier => !ALLOWED.has(specifier));
  if (external.length) throw new Error(`bundle is not dependency-free: ${external.join(', ')}`);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  const outfile = path.join(DIST, OUT_NAME);
  await writeFile(outfile, plain);
  await chmod(outfile, 0o755);
  const hash = createHash('sha256').update(plain).digest('hex');
  const sums = `${hash}  ${OUT_NAME}\n`;
  await writeFile(path.join(DIST, 'SHA256SUMS'), sums);

  // The skill ships this file. There is no npm package.
  await mkdir(SKILL_BIN, { recursive: true });
  const skillFile = path.join(SKILL_BIN, OUT_NAME);
  await writeFile(skillFile, plain);
  await chmod(skillFile, 0o755);
  await writeFile(path.join(SKILL_BIN, 'SHA256SUMS'), sums);

  process.stdout.write(`${JSON.stringify({
    file: OUT_NAME,
    minify: false,
    sha256: hash,
    plain: sizes(plain),
    minified: sizes(mini),
    skillBin: SKILL_BIN,
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
