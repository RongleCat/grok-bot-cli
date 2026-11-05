// Node.js 22.13 matches grok-bot-sdk engines. Bun 1.1 is the documented floor.
export const MIN_NODE_VERSION = '22.13.0';
export const MIN_BUN_VERSION = '1.1.0';

export function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), match[3] === undefined ? 0 : Number(match[3])];
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function detectRuntime(versions = process.versions) {
  // Bun also sets process.versions.node to a compatibility version. Prefer bun.
  if (typeof versions?.bun === 'string' && versions.bun) return { name: 'bun', version: versions.bun };
  if (typeof versions?.node === 'string' && versions.node) return { name: 'node', version: versions.node };
  return { name: 'unknown', version: '0.0.0' };
}

export function formatRuntimeVersion(version) {
  const text = String(version ?? '0.0.0');
  return text.startsWith('v') ? text : `v${text}`;
}

export function formatRuntimeLine(runtime) {
  return `runtime ${runtime.name} ${formatRuntimeVersion(runtime.version)}`;
}

export function unsupportedRuntime(runtime) {
  const parsed = parseVersion(runtime?.version);
  if (runtime?.name === 'node' && parsed && compareVersions(parsed, parseVersion(MIN_NODE_VERSION)) >= 0) return null;
  if (runtime?.name === 'bun' && parsed && compareVersions(parsed, parseVersion(MIN_BUN_VERSION)) >= 0) return null;
  const seen = `${runtime?.name ?? 'unknown'} ${formatRuntimeVersion(runtime?.version)}`;
  if (runtime?.name === 'node') {
    return `Node.js ${formatRuntimeVersion(runtime.version)} is too old. Install Node.js 22 LTS (22.13 or newer) or Bun.`;
  }
  return `This runtime is not supported (${seen}). Install Node.js 22 LTS (22.13 or newer) or Bun 1.1 or newer.`;
}
