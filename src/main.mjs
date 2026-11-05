#!/usr/bin/env node
import { programArgs } from './args.mjs';
import { runCli } from './cli.mjs';
import { finishProcess } from './exit.mjs';

try {
  const code = await runCli({ argv: programArgs(process.argv) });
  await finishProcess(code);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try { process.stderr.write(`${message}\n`); } catch { /* stderr may already be closed */ }
  await finishProcess(4);
}
