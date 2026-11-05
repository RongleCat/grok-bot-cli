#!/usr/bin/env node
// src/constants.mjs
var CLI_VERSION = "0.78.1";
var TARGET_VERSION = "0.78.1";
var DEFAULT_TIMEOUT_SEC = 600;
var LOGIN_WAIT_SEC = 300;
var MAX_TIMEOUT_SEC = 3600;
var START_TTL_SEC = 900;
var DEFAULT_IDLE_SEC = 2;
var MAX_RELAY_ROUNDS = 10;
var WAIT_TRANSCRIPT_LIMIT = 500;
var STATUS_PROBE_INTERVAL_MS = 15e3;
var EXIT_GRACE_MS = 2e3;
var OAUTH_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
var OAUTH_TOKEN_URL = "https://api2.cursor.sh/oauth/token";
var REFRESH_SKEW_MS = 3e5;

// src/args.mjs
function baseName(value) {
  const text = String(value ?? "");
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  return cut === -1 ? text : text.slice(cut + 1);
}
function programArgs(argv = process.argv) {
  let args = argv.slice(1);
  const first = args[0];
  if (!first || first.startsWith("-")) return args;
  const runtime = /^(?:node|nodejs|bun)(?:\.exe)?$/i.test(baseName(argv[0]));
  const script = runtime && (/\.(?:mjs|cjs|js)$/.test(first) || first.includes("/") || first.includes("\\"));
  if (first === argv[0] || first.includes("$bunfs/") || script) args = args.slice(1);
  return args;
}
var BOOLEANS = /* @__PURE__ */ new Set(["json", "help", "version", "start", "wait", "no-open", "check", "all-accounts", "dry-run", "yes"]);
var VALUES = /* @__PURE__ */ new Set(["profile", "account", "timeout", "idle-timeout", "bot", "text", "session", "limit", "file", "from", "to", "template", "rounds", "message-id", "page-token", "name", "description", "title", "member", "room", "user-id", "content", "content-file"]);
var PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var ACCOUNT_COMMANDS = /* @__PURE__ */ new Set(["list", "add", "use", "rename", "remove"]);
function takeValue(argv, index, name, inline) {
  if (inline !== void 0) return { value: inline, index };
  const next = argv[index + 1];
  if (next === void 0 || next.startsWith("--")) return { error: `--${name} needs a value` };
  return { value: next, index: index + 1 };
}
function parseNumber(value, name, { integer = false, allowZero = false } = {}) {
  if (value === "" || value == null) return { error: `--${name} needs a number` };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !allowZero && number === 0) return { error: `--${name} must be a ${allowZero ? "non-negative" : "positive"} number` };
  if (integer && !Number.isInteger(number)) return { error: `--${name} must be an integer` };
  return { value: number };
}
function parseArgs(argv) {
  const parsed = {
    ok: true,
    command: null,
    json: false,
    help: false,
    version: false,
    profile: null,
    account: null,
    start: false,
    wait: false,
    noOpen: false,
    check: false,
    allAccounts: false,
    dryRun: false,
    timeout: null,
    idleTimeout: null,
    bot: null,
    bots: [],
    text: null,
    session: null,
    limit: null,
    file: [],
    from: null,
    to: null,
    template: null,
    rounds: null,
    messageId: null,
    yes: false,
    pageToken: null,
    name: null,
    description: null,
    title: null,
    members: [],
    room: null,
    userIds: [],
    content: null,
    contentFile: null,
    errors: []
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "-V") {
      parsed.version = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? void 0 : arg.slice(eq + 1);
    if (!BOOLEANS.has(name) && !VALUES.has(name)) {
      parsed.errors.push(`Unknown flag --${name}`);
      continue;
    }
    if (BOOLEANS.has(name)) {
      if (inline !== void 0) parsed.errors.push(`--${name} does not take a value`);
      if (name === "json") parsed.json = true;
      else if (name === "help") parsed.help = true;
      else if (name === "version") parsed.version = true;
      else if (name === "start") parsed.start = true;
      else if (name === "wait") parsed.wait = true;
      else if (name === "no-open") parsed.noOpen = true;
      else if (name === "check") parsed.check = true;
      else if (name === "all-accounts") parsed.allAccounts = true;
      else if (name === "dry-run") parsed.dryRun = true;
      else if (name === "yes") parsed.yes = true;
      continue;
    }
    const taken = takeValue(argv, index, name, inline);
    if (taken.error) {
      parsed.errors.push(taken.error);
      continue;
    }
    index = taken.index;
    if (name === "file") {
      parsed.file.push(taken.value);
      continue;
    }
    if (name === "member") {
      parsed.members.push(taken.value);
      continue;
    }
    if (name === "user-id") {
      const number = parseNumber(taken.value, "user-id", { integer: true });
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > 2147483647) parsed.errors.push("--user-id must be an integer from 1 to 2147483647");
      else parsed.userIds.push(number.value);
      continue;
    }
    if (name === "profile" || name === "account") {
      if (!PROFILE.test(taken.value)) parsed.errors.push(`--${name} must be 1-64 letters, digits, "_" or "-"`);
      else if (name === "profile") parsed.profile = taken.value;
      else parsed.account = taken.value;
      continue;
    }
    if (name === "timeout") {
      const number = parseNumber(taken.value, "timeout");
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > MAX_TIMEOUT_SEC) parsed.errors.push(`--timeout must be from 1 to ${MAX_TIMEOUT_SEC} seconds`);
      else parsed.timeout = number.value;
      continue;
    }
    if (name === "idle-timeout") {
      const number = parseNumber(taken.value, "idle-timeout", { allowZero: true });
      if (number.error) parsed.errors.push(number.error);
      else parsed.idleTimeout = number.value;
      continue;
    }
    if (name === "limit") {
      const number = parseNumber(taken.value, "limit", { integer: true });
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > 500) parsed.errors.push("--limit must be from 1 to 500");
      else parsed.limit = number.value;
      continue;
    }
    if (name === "bot") {
      parsed.bots.push(taken.value);
      parsed.bot = parsed.bots[0];
    } else if (name === "text") parsed.text = taken.value;
    else if (name === "session") parsed.session = taken.value;
    else if (name === "from") parsed.from = taken.value;
    else if (name === "to") parsed.to = taken.value;
    else if (name === "template") parsed.template = taken.value;
    else if (name === "message-id") parsed.messageId = taken.value;
    else if (name === "rounds") {
      const number = parseNumber(taken.value, "rounds", { integer: true, allowZero: true });
      if (number.error) parsed.errors.push(number.error);
      else parsed.rounds = number.value;
    } else if (name === "page-token") parsed.pageToken = taken.value;
    else if (name === "name") parsed.name = taken.value;
    else if (name === "description") parsed.description = taken.value;
    else if (name === "title") parsed.title = taken.value;
    else if (name === "room") {
      if (parsed.room != null) parsed.errors.push("--room can be set only once");
      parsed.room = taken.value;
    } else if (name === "content") parsed.content = taken.value;
    else if (name === "content-file") parsed.contentFile = taken.value;
  }
  parsed.command = positionals[0] ?? null;
  parsed.args = positionals.slice(1);
  if (parsed.command === "bot" || parsed.command === "room" || parsed.command === "skill") {
    if (positionals.length > 2) parsed.errors.push(`Unexpected argument "${positionals[2]}"`);
  } else if (parsed.command !== "accounts" && positionals.length > 1) parsed.errors.push(`Unexpected argument "${positionals[1]}"`);
  if (parsed.command === "help") parsed.help = true;
  if (parsed.command === "version") parsed.version = true;
  parsed.ok = parsed.errors.length === 0;
  return parsed;
}
var COMMANDS = {
  login: ["start", "wait", "no-open", "timeout"],
  logout: [],
  status: ["all-accounts"],
  bots: ["all-accounts"],
  sessions: ["bot"],
  transcript: ["bot", "session", "limit"],
  tasks: ["bot", "session"],
  todos: ["bot"],
  skills: ["bot"],
  capabilities: [],
  box: [],
  send: ["bot", "text", "session", "file", "wait", "timeout", "idle-timeout"],
  watch: ["bot", "session"],
  wait: ["bot", "message-id", "session", "timeout", "idle-timeout"],
  relay: ["from", "to", "text", "template", "rounds", "timeout", "idle-timeout", "dry-run"],
  accounts: ["check", "start", "wait", "no-open", "timeout"],
  files: ["bot", "page-token"],
  invites: ["bot"]
};
var BOT_COMMANDS = /* @__PURE__ */ new Set(["create", "update", "duplicate", "delete"]);
var ROOM_COMMANDS = /* @__PURE__ */ new Set(["create", "add-member", "delete", "remove-member", "set-members"]);
var SKILL_COMMANDS = /* @__PURE__ */ new Set(["add", "update", "remove"]);
var BOT_FLAGS = {
  create: ["name", "description", "title"],
  update: ["bot", "name", "description", "title"],
  duplicate: ["bot", "name"],
  delete: ["bot", "yes"]
};
var ROOM_FLAGS = {
  create: ["name", "description", "member"],
  "add-member": ["room", "user-id"],
  delete: ["room", "yes"],
  "remove-member": ["room", "user-id", "yes"],
  "set-members": ["room", "member", "yes"]
};
var SKILL_FLAGS = {
  add: ["bot", "name", "content", "content-file", "description"],
  update: ["bot", "name", "content", "content-file", "description"],
  remove: ["bot", "name", "yes"]
};
var ACCOUNT_FLAGS = {
  list: ["check"],
  add: ["start", "wait", "no-open", "timeout"],
  use: [],
  rename: [],
  remove: []
};
var COMMAND_NAMES = /* @__PURE__ */ new Set([...Object.keys(COMMANDS), "bot", "room", "skill"]);
function usedFlags(parsed) {
  const used = [];
  if (parsed.start) used.push("start");
  if (parsed.wait) used.push("wait");
  if (parsed.noOpen) used.push("no-open");
  if (parsed.timeout != null) used.push("timeout");
  if (parsed.idleTimeout != null) used.push("idle-timeout");
  if (parsed.bot != null) used.push("bot");
  if (parsed.text != null) used.push("text");
  if (parsed.session != null) used.push("session");
  if (parsed.limit != null) used.push("limit");
  if (parsed.file.length) used.push("file");
  if (parsed.check) used.push("check");
  if (parsed.allAccounts) used.push("all-accounts");
  if (parsed.dryRun) used.push("dry-run");
  if (parsed.from != null) used.push("from");
  if (parsed.to != null) used.push("to");
  if (parsed.template != null) used.push("template");
  if (parsed.rounds != null) used.push("rounds");
  if (parsed.messageId != null) used.push("message-id");
  if (parsed.yes) used.push("yes");
  if (parsed.pageToken != null) used.push("page-token");
  if (parsed.name != null) used.push("name");
  if (parsed.description != null) used.push("description");
  if (parsed.title != null) used.push("title");
  if (parsed.members.length) used.push("member");
  if (parsed.room != null) used.push("room");
  if (parsed.userIds.length) used.push("user-id");
  if (parsed.content != null) used.push("content");
  if (parsed.contentFile != null) used.push("content-file");
  return used;
}
function validateAlias(value, label) {
  if (!PROFILE.test(value)) return `${label} must be 1-64 letters, digits, "_" or "-"`;
  return "";
}
function validateAccounts(parsed) {
  const [sub, ...rest] = parsed.args ?? [];
  if (!sub || !ACCOUNT_COMMANDS.has(sub)) {
    return [sub ? `Unknown accounts command "${sub}"` : "accounts requires list, add, use, rename, or remove"];
  }
  const errors = [];
  for (const flag of usedFlags(parsed)) {
    if (!ACCOUNT_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for accounts ${sub}`);
  }
  if (sub === "list" && rest.length) errors.push(`Unexpected argument "${rest[0]}"`);
  if (sub === "add") {
    if (rest.length !== 1) errors.push("accounts add requires <alias>");
    else {
      const aliasError = validateAlias(rest[0], "Account alias");
      if (aliasError) errors.push(aliasError);
    }
    if (parsed.start && parsed.wait) errors.push("--start and --wait cannot be combined");
  }
  if (sub === "use" || sub === "remove") {
    if (rest.length !== 1) errors.push(`accounts ${sub} requires <alias>`);
    else {
      const aliasError = validateAlias(rest[0], "Account alias");
      if (aliasError) errors.push(aliasError);
    }
  }
  if (sub === "rename") {
    if (rest.length !== 2) errors.push("accounts rename requires <old> <new>");
    else {
      const oldError = validateAlias(rest[0], "Account alias");
      const newError = validateAlias(rest[1], "Account alias");
      if (oldError || newError) errors.push(oldError || newError);
      else if (rest[0] === rest[1]) errors.push("accounts rename needs two different aliases");
    }
  }
  return errors;
}
function requireText(value, flag) {
  if (value == null) return "";
  if (!String(value).trim()) return `--${flag} must not be empty`;
  return "";
}
function requireContent(parsed, command) {
  const hasContent = parsed.content != null;
  const hasFile = parsed.contentFile != null;
  if (hasContent && hasFile) return [`${command} accepts either --content or --content-file`];
  if (!hasContent && !hasFile) return [`${command} requires --content or --content-file`];
  return [];
}
function validateBot(parsed) {
  const [sub] = parsed.args ?? [];
  if (!sub || !BOT_COMMANDS.has(sub)) {
    return [sub ? `Unknown bot command "${sub}"` : "bot requires create, update, duplicate, or delete"];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push("--bot can be repeated only for watch");
  for (const flag of usedFlags(parsed)) {
    if (!BOT_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for bot ${sub}`);
  }
  const nameError = requireText(parsed.name, "name");
  if (sub === "create") {
    if (parsed.name == null) errors.push("bot create requires --name <name>");
    else if (nameError) errors.push(nameError);
  }
  if (sub === "update") {
    if (!parsed.bot) errors.push("bot update requires --bot <id|name>");
    if (parsed.name == null && parsed.description == null && parsed.title == null) {
      errors.push("bot update requires --name, --description, or --title");
    }
    if (nameError) errors.push(nameError);
  }
  if (sub === "duplicate") {
    if (!parsed.bot) errors.push("bot duplicate requires --bot <id|name>");
    if (nameError) errors.push(nameError);
  }
  if (sub === "delete" && !parsed.bot) errors.push("bot delete requires --bot <id|name>");
  return errors;
}
function validateRoom(parsed) {
  const [sub] = parsed.args ?? [];
  if (!sub || !ROOM_COMMANDS.has(sub)) {
    return [sub ? `Unknown room command "${sub}"` : "room requires create, add-member, delete, remove-member, or set-members"];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push("--bot can be repeated only for watch");
  for (const flag of usedFlags(parsed)) {
    if (!ROOM_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for room ${sub}`);
  }
  const nameError = requireText(parsed.name, "name");
  if (sub === "create") {
    if (parsed.name == null) errors.push("room create requires --name <name>");
    else if (nameError) errors.push(nameError);
    if (!parsed.members.length) errors.push("room create requires --member <bot>");
  }
  if (sub === "add-member" || sub === "remove-member") {
    if (!parsed.room) errors.push(`room ${sub} requires --room <id|name>`);
    if (!parsed.userIds.length) errors.push(`room ${sub} requires --user-id <id>`);
  }
  if (sub === "delete" && !parsed.room) errors.push("room delete requires --room <id|name>");
  if (sub === "set-members") {
    if (!parsed.room) errors.push("room set-members requires --room <id|name>");
    if (!parsed.members.length) errors.push("room set-members requires --member <bot>");
  }
  return errors;
}
function validateSkill(parsed) {
  const [sub] = parsed.args ?? [];
  if (!sub || !SKILL_COMMANDS.has(sub)) {
    return [sub ? `Unknown skill command "${sub}"` : "skill requires add, update, or remove"];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push("--bot can be repeated only for watch");
  for (const flag of usedFlags(parsed)) {
    if (!SKILL_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for skill ${sub}`);
  }
  const nameError = requireText(parsed.name, "name");
  if (sub === "add" || sub === "update") {
    if (!parsed.bot) errors.push(`skill ${sub} requires --bot <id|name>`);
    if (parsed.name == null) errors.push(`skill ${sub} requires --name <name>`);
    else if (nameError) errors.push(nameError);
    errors.push(...requireContent(parsed, `skill ${sub}`));
  }
  if (sub === "remove") {
    if (!parsed.bot) errors.push("skill remove requires --bot <id|name>");
    if (parsed.name == null) errors.push("skill remove requires --name <name>");
    else if (nameError) errors.push(nameError);
  }
  return errors;
}
function validateCommand(parsed) {
  if (!parsed.command || parsed.command === "help" || parsed.command === "version") return [];
  if (parsed.account && parsed.profile && parsed.account !== parsed.profile) {
    return ["--account and --profile must name the same account"];
  }
  if (parsed.command === "accounts") return validateAccounts(parsed);
  if (parsed.command === "bot") return validateBot(parsed);
  if (parsed.command === "room") return validateRoom(parsed);
  if (parsed.command === "skill") return validateSkill(parsed);
  const allowed = COMMANDS[parsed.command];
  if (!allowed) return [`Unknown command "${parsed.command}"`];
  const errors = [];
  for (const flag of usedFlags(parsed)) {
    if (!allowed.includes(flag)) errors.push(`--${flag} is not valid for ${parsed.command}`);
  }
  if (parsed.command === "login" && parsed.start && parsed.wait) errors.push("--start and --wait cannot be combined");
  if ((parsed.command === "send" || parsed.command === "relay") && parsed.text != null && !parsed.text.trim()) errors.push("--text must not be empty");
  if (parsed.command === "send" && (parsed.timeout != null || parsed.idleTimeout != null) && !parsed.wait) {
    errors.push("--timeout and --idle-timeout require send --wait");
  }
  if (parsed.bots.length > 1 && parsed.command !== "watch") errors.push("--bot can be repeated only for watch");
  const needsBot = allowed.includes("bot");
  if (needsBot && !parsed.bot) errors.push(`${parsed.command} requires --bot <id|name>`);
  if (parsed.command === "send" && parsed.text == null) errors.push("send requires --text <text>");
  if (parsed.command === "wait" && !parsed.messageId) errors.push("wait requires --message-id <id>");
  if (parsed.command === "relay") {
    if (!parsed.from) errors.push("relay requires --from <bot>");
    if (!parsed.to) errors.push("relay requires --to <bot>");
    if (parsed.text == null) errors.push("relay requires --text <text>");
    if (parsed.rounds != null && (parsed.rounds < 1 || parsed.rounds > 10)) errors.push("--rounds must be an integer from 1 to 10");
  }
  return errors;
}

// src/cli.mjs
import { execFile } from "node:child_process";
import { access, constants, readFile as readFile2, rename as rename2 } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { setTimeout as delay2 } from "node:timers/promises";
import { promisify } from "node:util";

// node_modules/grok-bot-sdk/sdk.mjs
import { randomUUID as randomUUID2 } from "node:crypto";

// node_modules/grok-bot-sdk/core.mjs
import { randomBytes, randomUUID, createHash, pbkdf2Sync, createDecipheriv } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
var API_ORIGIN = "https://api2.cursor.sh";
var fixedError = (code) => new Error(code);
function createLogin() {
  const verifier = randomBytes(32).toString("base64url");
  const uuid = randomUUID();
  const url = new URL("/loginDeepControl", "https://cursor.com");
  url.search = new URLSearchParams({ challenge: createHash("sha256").update(verifier).digest("base64url"), uuid, mode: "login", redirectTarget: "sand", supportsSelectedTeamLogin: "true" }).toString();
  return { uuid, verifier, loginUrl: url.toString() };
}
function checksum(machineId) {
  const t = Math.floor(Date.now() / 1e6);
  const bytes = Uint8Array.from([t >> 40 & 255, t >> 32 & 255, t >> 24 & 255, t >> 16 & 255, t >> 8 & 255, t & 255]);
  let previous = 165;
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = (bytes[i] ^ previous) + i % 256;
    previous = bytes[i];
  }
  return Buffer.from(bytes).toString("base64url") + machineId;
}
function clientHeaders({ accessToken, version, machineId, teamId }) {
  const headers = {
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "authorization": `Bearer ${accessToken}`,
    "x-cursor-client-type": "sand",
    "x-cursor-client-version": version,
    "x-cursor-client-source": "sand-desktop",
    "x-cursor-client-os": "darwin",
    "x-sand-box-namespace": "prod",
    "x-ghost-mode": "true",
    "x-request-id": randomUUID(),
    "user-agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sand/${version} Safari/537.36`
  };
  if (machineId) headers["x-cursor-checksum"] = checksum(machineId);
  if (teamId !== void 0) headers["x-cursor-team-id"] = String(teamId);
  return headers;
}
async function requestJSON(url, { method = "POST", headers = {}, body, fetchImpl = fetch, timeoutMs = 2e4, signal } = {}) {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, { method, headers, body: body === void 0 ? void 0 : JSON.stringify(body), redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    const text = await response.text();
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) return { ok: false, httpStatus: response.status, code: "RESPONSE_TOO_LARGE" };
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, httpStatus: response.status, code: "NON_JSON_RESPONSE" };
    }
    const rawCode = typeof data?.code === "string" ? data.code : typeof data?.error === "string" ? data.error : "";
    if (!response.ok) return { ok: false, httpStatus: response.status, code: /^[a-z_]{1,48}$/.test(rawCode) ? rawCode : "HTTP_ERROR" };
    return { ok: true, httpStatus: response.status, data };
  } catch {
    return { ok: false, code: "NETWORK_OR_TLS_ERROR" };
  }
}
async function pollLogin(flow, { fetchImpl = fetch, sleep = delay, maxAttempts = 150, onPending = () => {
} } = {}) {
  const url = new URL("/auth/poll", API_ORIGIN);
  url.search = new URLSearchParams({ uuid: flow.uuid, verifier: flow.verifier }).toString();
  let errors = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await requestJSON(url, { method: "GET", headers: { "content-type": "application/json" }, fetchImpl });
    if (result.ok && typeof result.data.accessToken === "string" && typeof result.data.refreshToken === "string") return result.data;
    if (result.httpStatus === 403 && result.code === "sign_in_policy_violation") throw fixedError("SIGN_IN_POLICY_VIOLATION");
    if (result.httpStatus === 404) {
      errors = 0;
      onPending(attempt + 1);
    } else if (++errors >= 3) throw fixedError("LOGIN_POLL_FAILED");
    await sleep(Math.min(1e3 * 1.2 ** attempt, 1e4));
  }
  throw fixedError("LOGIN_TIMED_OUT");
}

// node_modules/grok-bot-sdk/avatar.mjs
var AVATAR_ALGORITHM_VERSION = "grok-bot-0.70.2";
var DEFAULT_SHAPES = Object.freeze(["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"]);
var VALID_SHAPES = Object.freeze(["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star", "pumpkin"]);
var DEFAULT_COLORS = Object.freeze(["brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"]);
var PALETTE = Object.freeze(Object.fromEntries([
  ["black", "#000000", "#000000", "#FFFFFF"],
  ["brown", "#936439", "#A27952", "#855C36"],
  ["red", "#FF263C", "#FF3E51", "#E02135"],
  ["orange", "#FF6700", "#FF781C", "#FF6700"],
  ["yellow", "#FF9800", "#FFAF38", "#FF9800"],
  ["green", "#00C972", "#00C972", "#009957"],
  ["cyan", "#00BCA6", "#1CC3B0", "#00A592"],
  ["blue", "#1084FE", "#2A92FE", "#0E74E0"],
  ["violet", "#9159FE", "#A97EFE", "#804EE0"],
  ["magenta", "#FF309B", "#FF5EB1", "#E02A88"],
  ["gray", "#777777", "#959595", "#777777"]
].map(([color, baseHex, lightHex, darkHex]) => [color, Object.freeze({ baseHex, lightHex, darkHex })])));
function hashBotId(key) {
  if (typeof key !== "string" || !key.length) throw new Error("AVATAR_KEY_REQUIRED");
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function deriveDefaultAvatar(key) {
  const hash = hashBotId(key);
  let shapeHash = hash | 0;
  shapeHash = Math.imul(shapeHash ^ shapeHash >>> 16, 73244475);
  shapeHash = Math.imul(shapeHash ^ shapeHash >>> 13, 3266489909);
  shapeHash = (shapeHash ^ shapeHash >>> 16) >>> 0;
  const shapeIndex = shapeHash % DEFAULT_SHAPES.length;
  const identitySaltVersion = 1, paletteSaltVersion = 1;
  const identitySeed = (hash ^ Math.imul(identitySaltVersion, 2654435769)) >>> 0;
  let seed = (identitySeed ^ Math.imul(paletteSaltVersion, 2654435769)) >>> 0;
  seed = seed + 1831565813 | 0;
  let sample = Math.imul(seed ^ seed >>> 15, 1 | seed);
  sample = sample + Math.imul(sample ^ sample >>> 7, 61 | sample) ^ sample;
  const random = ((sample ^ sample >>> 14) >>> 0) / 4294967296;
  const colorIndex = Math.floor(random * DEFAULT_COLORS.length);
  const shape = DEFAULT_SHAPES[shapeIndex], color = DEFAULT_COLORS[colorIndex];
  return { algorithmVersion: AVATAR_ALGORITHM_VERSION, hash, shapeHash, shapeIndex, colorIndex, shape, color, ...PALETTE[color] };
}
function resolveAgentAvatar(agent) {
  if (typeof agent?.agentId !== "string" || !agent.agentId.length) throw new Error("AVATAR_AGENT_ID_REQUIRED");
  const derived = deriveDefaultAvatar(agent.agentId);
  const explicitShape = VALID_SHAPES.includes(agent.avatarShape);
  const explicitColor = typeof agent.avatarColor === "string" && Object.hasOwn(PALETTE, agent.avatarColor);
  const shape = explicitShape ? agent.avatarShape : derived.shape;
  const color = explicitColor ? agent.avatarColor : derived.color;
  const nonempty = (value) => typeof value === "string" && value.length > 0;
  const url = nonempty(agent.avatarUrl) ? agent.avatarUrl : nonempty(agent.avatarDataUrl) ? agent.avatarDataUrl : null;
  const version = nonempty(agent.avatarVersion) ? agent.avatarVersion : null;
  return {
    algorithmVersion: AVATAR_ALGORITHM_VERSION,
    kind: url || version ? "picture" : "character",
    character: { shape, color, ...PALETTE[color] },
    sources: { shape: explicitShape ? "explicit" : "id-default", color: explicitColor ? "explicit" : "id-default" },
    picture: url || version ? { url, version } : null
  };
}

// node_modules/grok-bot-sdk/errors.mjs
var CODES = /* @__PURE__ */ new Set(["SDK_ERROR", "MISSING_ACCESS_TOKEN", "RPC_FAILED", "ACCOUNT_AUTH_FAILED", "INVALID_ROSTER_RESPONSE", "INVALID_BOT_RECORD", "BOT_ID_REQUIRED", "NOT_A_ROOM", "MESSAGE_INVALID", "SEND_UNCONFIRMED", "SEND_REFUSED", "CURSOR_INVALID", "CURSOR_SCOPE_MISMATCH", "STREAM_CONNECTION_FAILED", "STREAM_RPC_ERROR", "STREAM_FRAME_TOO_LARGE", "STREAM_UNEXPECTED_EOF", "STREAM_COMPRESSION_UNSUPPORTED", "STREAM_FLAGS_INVALID", "STREAM_INVALID_JSON", "STREAM_END_INVALID", "STREAM_INVALID_RESPONSE", "STREAM_PROTOCOL_ERROR", "STREAM_CANCELLED"]);
var SDKError = class extends Error {
  constructor(code, httpStatus) {
    super(CODES.has(code) ? code : "SDK_ERROR");
    this.name = "SDKError";
    this.code = this.message;
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus;
  }
};

// node_modules/grok-bot-sdk/connect-stream.mjs
function encodeConnectFrame(data) {
  const payload = Buffer.from(JSON.stringify(data));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}
async function* readConnectFrames(body, { maxFrameBytes = 1024 * 1024, onClose = () => {
} } = {}) {
  if (!body?.getReader) throw new SDKError("STREAM_INVALID_RESPONSE");
  const reader = body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = Buffer.alloc(0);
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) throw new SDKError("STREAM_UNEXPECTED_EOF");
      pending = Buffer.concat([pending, Buffer.from(value)]);
      while (pending.length >= 5) {
        const flags = pending[0], length = pending.readUInt32BE(1);
        if (length > maxFrameBytes) throw new SDKError("STREAM_FRAME_TOO_LARGE");
        if (flags & 1) throw new SDKError("STREAM_COMPRESSION_UNSUPPORTED");
        if (flags !== 0 && flags !== 2) throw new SDKError("STREAM_FLAGS_INVALID");
        if (pending.length < 5 + length) break;
        let data;
        try {
          data = JSON.parse(decoder.decode(pending.subarray(5, 5 + length)));
        } catch {
          throw new SDKError("STREAM_INVALID_JSON");
        }
        pending = pending.subarray(5 + length);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new SDKError("STREAM_INVALID_JSON");
        if (flags === 2) {
          if (Object.hasOwn(data, "error")) throw new SDKError("STREAM_RPC_ERROR");
          if (pending.length) throw new SDKError("STREAM_END_INVALID");
          return;
        }
        yield data;
      }
    }
  } finally {
    onClose();
    await reader.cancel().catch(() => {
    });
    reader.releaseLock();
  }
}

// node_modules/grok-bot-sdk/sse.mjs
var encoder = new TextEncoder();
function encodeEvent(event) {
  if (typeof event.type !== "string" || !/^[a-z][a-z0-9._-]{0,60}$/.test(event.type)) throw new SDKError("STREAM_PROTOCOL_ERROR");
  if (event.id !== void 0 && (typeof event.id !== "string" || event.id.length > 2048 || /[\r\n\0]/.test(event.id))) throw new SDKError("STREAM_PROTOCOL_ERROR");
  return encoder.encode(`event: ${event.type}
${event.id !== void 0 ? `id: ${event.id}
` : ""}data: ${JSON.stringify(event.data ?? {})}

`);
}
function eventsToSSE(events, { signal, keepAliveMs = 15e3, onCancel = () => {
} } = {}) {
  const iterator = events[Symbol.asyncIterator]();
  let stopped = false, timer, abortHandler;
  const cleanup = () => {
    clearInterval(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  };
  const stream = new ReadableStream({
    start(controller) {
      abortHandler = () => {
        if (stopped) return;
        stopped = true;
        cleanup();
        onCancel();
        controller.close();
        void iterator.return?.().catch(() => {
        });
      };
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      signal?.addEventListener("abort", abortHandler, { once: true });
      if (keepAliveMs > 0) {
        timer = setInterval(() => {
          if (!stopped && controller.desiredSize > 0) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, keepAliveMs);
        timer.unref?.();
      }
    },
    async pull(controller) {
      if (stopped) return;
      try {
        const next = await iterator.next();
        if (stopped) return;
        if (next.done) {
          controller.enqueue(encodeEvent({ type: "stream.closed", data: {} }));
          stopped = true;
          cleanup();
          controller.close();
        } else controller.enqueue(encodeEvent(next.value));
      } catch (error) {
        if (stopped) return;
        const code = error instanceof SDKError ? error.code : "SDK_ERROR";
        controller.enqueue(encodeEvent({ type: "error", data: { code } }));
        stopped = true;
        cleanup();
        onCancel();
        controller.close();
        void iterator.return?.().catch(() => {
        });
      }
    },
    async cancel() {
      stopped = true;
      cleanup();
      onCancel();
      await iterator.return?.().catch(() => {
      });
    }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}

// node_modules/grok-bot-sdk/sdk.mjs
var CLIENT_VERSION = "0.78.1";
var SEND_STATUS = { 0: "unspecified", 1: "not-found", 2: "accepted", 3: "rejected", 4: "pending", 5: "unknown-durability", GROK_BOT_SEND_STATUS_UNSPECIFIED: "unspecified", GROK_BOT_SEND_STATUS_NOT_FOUND: "not-found", GROK_BOT_SEND_STATUS_ACCEPTED: "accepted", GROK_BOT_SEND_STATUS_REJECTED: "rejected", GROK_BOT_SEND_STATUS_PENDING: "pending", GROK_BOT_SEND_STATUS_UNKNOWN_DURABILITY: "unknown-durability" };
var RUN_STATE = { 0: "unspecified", 1: "absent", 2: "hibernated", 3: "running", 4: "starting", SAND_BOX_RUN_STATE_UNSPECIFIED: "unspecified", SAND_BOX_RUN_STATE_ABSENT: "absent", SAND_BOX_RUN_STATE_HIBERNATED: "hibernated", SAND_BOX_RUN_STATE_RUNNING: "running", SAND_BOX_RUN_STATE_STARTING: "starting" };
var ROOM_KIND = /* @__PURE__ */ new Set(["2", "ROOM", "GROK_BOT_AGENT_KIND_ROOM"]);
var HARNESS_WIRE = { 0: "UNSPECIFIED", 1: "BOX", 2: "TEMPORAL", UNSPECIFIED: "UNSPECIFIED", BOX: "BOX", TEMPORAL: "TEMPORAL", GROK_BOT_AGENT_HARNESS_KIND_UNSPECIFIED: "UNSPECIFIED", GROK_BOT_AGENT_HARNESS_KIND_BOX: "BOX", GROK_BOT_AGENT_HARNESS_KIND_TEMPORAL: "TEMPORAL" };
var HARNESS_OUT = { 0: "unspecified", 1: "box", 2: "temporal", UNSPECIFIED: "unspecified", BOX: "box", TEMPORAL: "temporal", GROK_BOT_AGENT_HARNESS_KIND_UNSPECIFIED: "unspecified", GROK_BOT_AGENT_HARNESS_KIND_BOX: "box", GROK_BOT_AGENT_HARNESS_KIND_TEMPORAL: "temporal" };
var CREATE_INTENT_WIRE = { 0: "UNSPECIFIED", 1: "FRESH", 2: "REGISTER_EXISTING_LOCAL", UNSPECIFIED: "UNSPECIFIED", FRESH: "FRESH", REGISTER_EXISTING_LOCAL: "REGISTER_EXISTING_LOCAL", GROK_BOT_AGENT_CREATE_INTENT_UNSPECIFIED: "UNSPECIFIED", GROK_BOT_AGENT_CREATE_INTENT_FRESH: "FRESH", GROK_BOT_AGENT_CREATE_INTENT_REGISTER_EXISTING_LOCAL: "REGISTER_EXISTING_LOCAL" };
var CREATE_CALLER_WIRE = { 0: "UNSPECIFIED", 1: "ROOM_MEMBERS", 2: "ENSURE_SERVER_BACKED", 3: "MINT", 4: "BACKFILL", 5: "PRODUCT_CREATE", UNSPECIFIED: "UNSPECIFIED", ROOM_MEMBERS: "ROOM_MEMBERS", ENSURE_SERVER_BACKED: "ENSURE_SERVER_BACKED", MINT: "MINT", BACKFILL: "BACKFILL", PRODUCT_CREATE: "PRODUCT_CREATE", GROK_BOT_AGENT_CREATE_CALLER_UNSPECIFIED: "UNSPECIFIED", GROK_BOT_AGENT_CREATE_CALLER_ROOM_MEMBERS: "ROOM_MEMBERS", GROK_BOT_AGENT_CREATE_CALLER_ENSURE_SERVER_BACKED: "ENSURE_SERVER_BACKED", GROK_BOT_AGENT_CREATE_CALLER_MINT: "MINT", GROK_BOT_AGENT_CREATE_CALLER_BACKFILL: "BACKFILL", GROK_BOT_AGENT_CREATE_CALLER_PRODUCT_CREATE: "PRODUCT_CREATE" };
function botKey(value) {
  if (typeof value !== "string" || !value.length || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new SDKError("BOT_ID_REQUIRED");
  return value;
}
function botIds(values, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || !allowEmpty && !values.length) throw new SDKError("BOT_ID_REQUIRED");
  return values.map(botKey);
}
function asText(value) {
  return typeof value === "string" ? value : "";
}
function wireText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function msText(value) {
  if (typeof value === "string" && /^-?\d{1,20}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}
function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function wireList(value) {
  return Array.isArray(value) ? value.map(wireText).filter((item) => item.length > 0) : [];
}
function mappedEnum(value, table) {
  if (Object.hasOwn(table, value)) return table[value];
  return wireText(value) || "unspecified";
}
function objectRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}
function uint64(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new SDKError("CURSOR_INVALID");
  const text = String(value ?? 0);
  if (!/^\d{1,20}$/.test(text) || BigInt(text) > 18446744073709551615n) throw new SDKError("CURSOR_INVALID");
  return String(BigInt(text));
}
function generation(value) {
  const number = value ?? 0;
  if (!Number.isInteger(number) || number < 0 || number > 4294967295) throw new SDKError("CURSOR_INVALID");
  return number;
}
function cursorID(botId, sessionId, state) {
  return Buffer.from(JSON.stringify({ botId, sessionId, generation: state.generation, afterUpdatedSeq: state.afterUpdatedSeq })).toString("base64url");
}
function resumeCursor(value, botId, sessionId) {
  let parsed;
  try {
    if (typeof value !== "string" || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new SDKError("CURSOR_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SDKError("CURSOR_INVALID");
  if (parsed.botId !== botId || parsed.sessionId !== sessionId) throw new SDKError("CURSOR_SCOPE_MISMATCH");
  return { generation: generation(parsed.generation), afterUpdatedSeq: uint64(parsed.afterUpdatedSeq) };
}
function decodeEntry(entry) {
  if (typeof entry.body !== "string" || !entry.body) return null;
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(entry.body, "base64")));
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
function normalizeSlackConnection(row) {
  return { agentId: asText(row.agentId), connected: row.connected === true, workspaceName: typeof row.workspaceName === "string" ? row.workspaceName : null, installUrl: typeof row.installUrl === "string" ? row.installUrl : null, unavailableReason: typeof row.unavailableReason === "string" ? row.unavailableReason : null, pendingAdminApproval: row.pendingAdminApproval === true, needsManifestUpdate: row.needsManifestUpdate === true, reinstallUrl: typeof row.reinstallUrl === "string" ? row.reinstallUrl : null, approvalDenied: row.approvalDenied === true, appUnreachable: row.appUnreachable === true, removedInSlack: row.removedInSlack === true, approvalRequestUnsent: row.approvalRequestUnsent === true };
}
function normalizeInstalledTeam(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { teamId: asText(row.teamId), displayName: asText(row.displayName), rscGranted: row.rscGranted === true, installedAtMs: msText(row.installedAtMs) };
}
function normalizeTeamsConnection(row) {
  return { agentId: asText(row.agentId), installState: wireText(row.installState), tenantId: typeof row.tenantId === "string" ? row.tenantId : null, tenantDisplayName: typeof row.tenantDisplayName === "string" ? row.tenantDisplayName : null, installedTeamCount: Number.isInteger(row.installedTeamCount) ? row.installedTeamCount : 0, installedTeams: objectRows(row.installedTeams).map(normalizeInstalledTeam).filter(Boolean) };
}
function normalizeSession(row) {
  return { agentId: asText(row.agentId), sessionId: asText(row.sessionId), kind: wireText(row.kind), createdAtMs: msText(row.createdAtMs), updatedAtMs: msText(row.updatedAtMs), lastActivityAtMs: msText(row.lastActivityAtMs) };
}
function normalizeTranscriptEntry(entry) {
  return { seq: uint64(entry?.seq), updatedSeq: uint64(entry?.updatedSeq ?? entry?.seq), entryId: typeof entry?.entryId === "string" ? entry.entryId : null, entryKind: asText(entry?.entryKind), bodyOmitted: entry?.bodyOmitted === true, blobHash: typeof entry?.blobHash === "string" ? entry.blobHash : null, body: decodeEntry(entry ?? {}) };
}
function normalizeUnreadAnchor(anchor) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return null;
  return { hasNewerRows: anchor.hasNewerRows === true, entryId: asText(anchor.entryId), seq: msText(anchor.seq), newerRows: Number.isInteger(anchor.newerRows) ? anchor.newerRows : 0 };
}
function normalizeLiveState(row) {
  return { agentId: asText(row.agentId), sessionId: asText(row.sessionId), isRunning: row.isRunning === true, isComposingMessage: row.isComposingMessage === true, isRetrying: row.isRetrying === true, updatedAtMs: msText(row.updatedAtMs), staleAfterMs: msText(row.staleAfterMs), hasRunningSubagents: row.hasRunningSubagents === true, surfaceTaskId: asText(row.surfaceTaskId), workingTaskIds: stringList(row.workingTaskIds), activityKind: asText(row.activity?.kind) };
}
function normalizeClientState(row) {
  return { agentId: asText(row.agentId), lastViewedAtMs: msText(row.lastViewedAtMs), unreadCount: Number.isInteger(row.unreadCount) ? row.unreadCount : 0, lastActivityAtMs: msText(row.lastActivityAtMs), lastEntryId: asText(row.lastEntryId), lastEntryKind: asText(row.lastEntryKind), lastMessageId: asText(row.lastMessageId), lastMessagePreview: asText(row.lastMessagePreview), notificationsEnabled: row.notificationsEnabled === true, notifyOnUpdatesEnabled: row.notifyOnUpdatesEnabled === true, hiddenFromSidebar: row.hiddenFromSidebar === true, updatedAtMs: msText(row.updatedAtMs), lastMessageTaskId: asText(row.lastMessageTaskId), removedFromSidebar: row.removedFromSidebar === true, unreadThreadCount: Number.isInteger(row.unreadThreadCount) ? row.unreadThreadCount : 0 };
}
function normalizeBoxState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const textOrNull = (value) => typeof value === "string" ? value : null;
  return { runState: mappedEnum(state.runState, RUN_STATE), recreateInFlight: state.recreateInFlight === true, imageUpdateAvailable: state.imageUpdateAvailable === true, hostVersion: textOrNull(state.hostVersion), hostUpdateAvailable: state.hostUpdateAvailable === true, diskPressure: wireText(state.diskPressure), updatedAtMs: msText(state.updatedAtMs), imageTag: textOrNull(state.imageTag), staticSnapshotPath: textOrNull(state.staticSnapshotPath), imageGitSha: textOrNull(state.imageGitSha), staticSnapshotMatchesPin: state.staticSnapshotMatchesPin === true, staticSnapshotPin: textOrNull(state.staticSnapshotPin) };
}
function normalizeComputerAction(row) {
  const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return { agentId: asText(row.agentId), type: asText(row.type), x: number(row.x), y: number(row.y), button: asText(row.button), count: Number.isInteger(row.count) ? row.count : 0, atMs: msText(row.atMs) };
}
function isRoomKind(kind) {
  return ROOM_KIND.has(kind);
}
function requiredText(value) {
  if (typeof value !== "string" || !value) throw new SDKError("MESSAGE_INVALID");
  return value;
}
function defaultText(value) {
  if (value === void 0) return "";
  if (typeof value !== "string") throw new SDKError("MESSAGE_INVALID");
  return value;
}
function optionalString(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || !value) throw new SDKError("MESSAGE_INVALID");
  return value;
}
function presentString(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "string") throw new SDKError("MESSAGE_INVALID");
  return value;
}
function returnedBot(agent) {
  try {
    return normalizeBot(agent);
  } catch (error) {
    if (error instanceof SDKError && error.code === "INVALID_BOT_RECORD") throw new SDKError("RPC_FAILED");
    throw error;
  }
}
function optionalBool(value) {
  if (value === void 0) return void 0;
  if (typeof value !== "boolean") throw new SDKError("MESSAGE_INVALID");
  return value;
}
function enumWire(value, table) {
  if (!Object.hasOwn(table, value)) throw new SDKError("MESSAGE_INVALID");
  return table[value];
}
function optionalEnum(value, table) {
  if (value === void 0) return void 0;
  return enumWire(value, table);
}
function int32List(values) {
  if (!Array.isArray(values)) throw new SDKError("MESSAGE_INVALID");
  return values.map((value) => {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new SDKError("MESSAGE_INVALID");
    return value;
  });
}
function int64Text(value) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^-?\d{1,19}$/.test(value)) {
    const number = BigInt(value);
    if (number >= -9223372036854775808n && number <= 9223372036854775807n) return number.toString();
  }
  return "";
}
function int64Wire(value) {
  const text = int64Text(value);
  if (!text || text.startsWith("-")) throw new SDKError("MESSAGE_INVALID");
  return text;
}
function putField(body, key, value) {
  if (value !== void 0) body[key] = value;
}
function normalizePluginSkill(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { name: asText(row.name), description: asText(row.description), sourcePath: asText(row.sourcePath), sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null, content: asText(row.content), environments: stringList(row.environments) };
}
function normalizeMarketplace(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { marketplaceId: int64Text(row.marketplaceId), displayName: asText(row.displayName), description: asText(row.description) };
}
function normalizeDelegatedCredential(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { delegatorDisplayName: asText(row.delegatorDisplayName), delegatorAvatarUrl: typeof row.delegatorAvatarUrl === "string" ? row.delegatorAvatarUrl : null, delegatorIsViewer: row.delegatorIsViewer === true, state: wireText(row.state), attachedAt: typeof row.attachedAt === "string" ? row.attachedAt : null };
}
function normalizePlugin(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { pluginId: int64Text(row.pluginId), name: asText(row.name), displayName: asText(row.displayName), description: asText(row.description), logoUrl: typeof row.logoUrl === "string" ? row.logoUrl : null, ownedByMarketplace: row.ownedByMarketplace === true, installMode: asText(row.installMode), variableNames: stringList(row.variableNames), isDeprecated: row.isDeprecated === true, mcpConfigJson: typeof row.mcpConfigJson === "string" ? row.mcpConfigJson : null, skills: objectRows(row.skills).map(normalizePluginSkill).filter(Boolean), mcpServerNames: stringList(row.mcpServerNames), isBotSkills: row.isBotSkills === true, connectorType: wireText(row.connectorType), variablesJson: typeof row.variablesJson === "string" ? row.variablesJson : null, hasConfiguredVariables: row.hasConfiguredVariables === true, credentialSource: wireText(row.credentialSource), delegatedCredential: normalizeDelegatedCredential(row.delegatedCredential), credentialAllowedActions: wireList(row.credentialAllowedActions), supportsServiceAccount: row.supportsServiceAccount === true };
}
function normalizeCustomMcp(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const http = row.http && typeof row.http === "object" && !Array.isArray(row.http) ? { url: asText(row.http.url), headerNames: stringList(row.http.headerNames), hasOauthClientId: row.http.hasOauthClientId === true, hasOauthClientSecret: row.http.hasOauthClientSecret === true } : null;
  const stdio = row.stdio && typeof row.stdio === "object" && !Array.isArray(row.stdio) ? { command: asText(row.stdio.command), args: stringList(row.stdio.args), hasEnv: row.stdio.hasEnv === true } : null;
  return { pluginId: int64Text(row.pluginId), name: asText(row.name), http, stdio };
}
function normalizeAccessInvite(row) {
  return { email: asText(row.email), expiresAtMs: msText(row.expiresAtMs), lastSharedAtMs: msText(row.lastSharedAtMs), createdAtMs: msText(row.createdAtMs) };
}
function normalizeCapUsage(row) {
  return { used: Number.isInteger(row?.used) ? row.used : 0, limit: Number.isInteger(row?.limit) ? row.limit : 0 };
}
function normalizeInviteBot(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { agentId: asText(row.agentId), name: asText(row.name), avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null, avatarShape: asText(row.avatarShape), avatarColor: asText(row.avatarColor) };
}
function normalizeInviteSender(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { displayName: asText(row.displayName), avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : null };
}
function normalizeInviteEligibility(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { eligible: row.eligible === true, reason: wireText(row.reason), currentTier: wireText(row.currentTier) };
}
function nonNegativeInt64(value) {
  const text = int64Text(value);
  return text && !text.startsWith("-") ? text : "0";
}
function normalizeAgentFile(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return { name: asText(row.name), path: asText(row.path), sizeBytes: nonNegativeInt64(row.sizeBytes), contentType: asText(row.contentType), updatedAtMs: msText(row.updatedAtMs), etag: asText(row.etag) };
}
function skillWriteResult(data, { requireSkill }) {
  if (!Array.isArray(data?.plugins)) throw new SDKError("RPC_FAILED");
  const marketplace = normalizeMarketplace(data.marketplace);
  if (!marketplace) throw new SDKError("RPC_FAILED");
  const plugins = data.plugins.map(normalizePlugin);
  if (plugins.some((row) => !row)) throw new SDKError("RPC_FAILED");
  const result = { marketplace, plugins };
  if (!requireSkill) return result;
  const skill = normalizePluginSkill(data.skill);
  if (!skill) throw new SDKError("RPC_FAILED");
  return { ...result, skill };
}
function normalizeBot(agent) {
  if (!agent || typeof agent.agentId !== "string" || !agent.agentId) throw new SDKError("INVALID_BOT_RECORD");
  const avatar = resolveAgentAvatar(agent);
  return { id: agent.agentId, serverId: typeof agent.id === "string" ? agent.id : null, legacyAgentId: asText(agent.legacyAgentId), name: asText(agent.name), description: asText(agent.description), title: asText(agent.title), avatarShape: avatar.character.shape, avatarColor: avatar.character.color, avatar, harness: asText(agent.harness), role: asText(agent.role), kind: wireText(agent.kind), visibility: wireText(agent.visibility), sessionId: asText(agent.viewerSessionId), teamId: Number.isInteger(agent.teamId) ? agent.teamId : null, viewerIsOwner: agent.viewerIsOwner === true, viewerCanManage: agent.viewerCanManage === true, teamDefaultForViewer: agent.teamDefaultForViewer === true, ownerDisplayName: asText(agent.ownerDisplayName), draftingDisabled: agent.draftingDisabled === true, accessGrantsOnly: agent.accessGrantsOnly === true, accessOwnerOnly: agent.accessOwnerOnly === true, memberAgentIds: stringList(agent.memberAgentIds), viewerAllowedActions: wireList(agent.viewerAllowedActions), createdAtMs: msText(agent.createdAtMs), updatedAtMs: msText(agent.updatedAtMs), voiceId: asText(agent.voiceId), voiceSpeed: typeof agent.voiceSpeed === "number" && Number.isFinite(agent.voiceSpeed) ? agent.voiceSpeed : null, voiceLanguage: asText(agent.voiceLanguage) };
}
var GrokBotClient = class {
  #options;
  constructor(options) {
    if (typeof options?.accessToken !== "string" || !options.accessToken) throw new SDKError("MISSING_ACCESS_TOKEN");
    this.#options = { ...options, version: options.version ?? CLIENT_VERSION };
  }
  async #rpc(service, method, body, signal) {
    return requestJSON(`${API_ORIGIN}/aiserver.v1.${service}/${method}`, { headers: clientHeaders(this.#options), body, fetchImpl: this.#options.fetchImpl, signal });
  }
  async #data(service, method, body) {
    const response = await this.#rpc(service, method, body);
    if (!response.ok) throw new SDKError("RPC_FAILED", response.httpStatus);
    return response.data ?? {};
  }
  async getMe() {
    const response = await this.#rpc("DashboardService", "GetMe", {});
    if (!response.ok || !(response.data?.authId || response.data?.userId)) throw new SDKError("ACCOUNT_AUTH_FAILED", response.httpStatus);
    return response.data;
  }
  async listBots({ includeTeamAgents = true, role, addedTeamAgentsOnly } = {}) {
    const body = { includeTeamAgents };
    if (role !== void 0) {
      if (typeof role !== "string") throw new SDKError("MESSAGE_INVALID");
      body.role = role;
    }
    if (addedTeamAgentsOnly !== void 0) body.addedTeamAgentsOnly = addedTeamAgentsOnly === true;
    const response = await this.#rpc("GrokBotService", "ListGrokBotAgents", body);
    if (!response.ok) throw new SDKError("RPC_FAILED", response.httpStatus);
    if (!Array.isArray(response.data?.agents)) throw new SDKError("INVALID_ROSTER_RESPONSE");
    return { bots: response.data.agents.map(normalizeBot), truncated: response.data.truncated === true, slackConnections: objectRows(response.data.slackConnections).map(normalizeSlackConnection), teamsConnections: objectRows(response.data.teamsConnections).map(normalizeTeamsConnection) };
  }
  async sendMessage({ botId, text, sessionId = "", messageId = randomUUID2(), attachmentPaths = [], attachmentNames = [], replyToId, replyQuote, taskId, language, richText, machineId, rendersMcpElicitationForms } = {}) {
    botKey(botId);
    if (typeof text !== "string" || !text.trim() || typeof sessionId !== "string" || typeof messageId !== "string" || !messageId || !Array.isArray(attachmentPaths) || !Array.isArray(attachmentNames) || attachmentPaths.length !== attachmentNames.length || [...attachmentPaths, ...attachmentNames].some((value) => typeof value !== "string" || !value)) throw new SDKError("MESSAGE_INVALID");
    if (rendersMcpElicitationForms !== void 0 && typeof rendersMcpElicitationForms !== "boolean") throw new SDKError("MESSAGE_INVALID");
    const extra = {};
    const put = (key, value) => {
      if (value === void 0) return;
      if (typeof value !== "string" || !value) throw new SDKError("MESSAGE_INVALID");
      extra[key] = value;
    };
    put("replyToId", replyToId);
    put("replyQuote", replyQuote);
    put("taskId", taskId);
    put("language", language);
    put("machineId", machineId);
    if (richText !== void 0) {
      if (typeof richText !== "string") throw new SDKError("MESSAGE_INVALID");
      extra.richText = richText;
    }
    if (rendersMcpElicitationForms === true) extra.rendersMcpElicitationForms = true;
    const response = await this.#rpc("GrokBotService", "SendGrokBotUserMessage", { agentId: botId, text, sessionId, messageId, attachmentPaths, attachmentNames, sentAtMs: String(Date.now()), isFork: false, source: 1, initiator: 1, sendSource: 1, ...extra });
    if (!response.ok) throw new SDKError("SEND_UNCONFIRMED", response.httpStatus);
    const deliveries = { 1: "accepted-box", 2: "accepted-temporal", 3: "duplicate", GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_BOX: "accepted-box", GROK_BOT_USER_MESSAGE_DELIVERY_ACCEPTED_TEMPORAL: "accepted-temporal", GROK_BOT_USER_MESSAGE_DELIVERY_DUPLICATE: "duplicate" };
    const delivery = deliveries[response.data?.delivery];
    if (!delivery) throw new SDKError("SEND_REFUSED");
    return { botId, messageId, delivery, dispatched: response.data.dispatched === true };
  }
  async listSessions(botId) {
    botKey(botId);
    const data = await this.#data("GrokBotService", "ListGrokBotAgentSessions", { agentId: botId });
    if (data.sessions !== void 0 && !Array.isArray(data.sessions)) throw new SDKError("RPC_FAILED");
    return { sessions: objectRows(data.sessions ?? []).map(normalizeSession) };
  }
  async listTranscript({ botId, sessionId = "", limit = 50, generation: generationValue, beforeSeq, unreadBoundaryMs } = {}) {
    botKey(botId);
    if (typeof sessionId !== "string" || sessionId.length > 256 || !Number.isInteger(limit) || limit < 1 || limit > 4294967295) throw new SDKError("CURSOR_INVALID");
    const body = { agentId: botId, sessionId, limit };
    if (generationValue !== void 0) body.generation = generation(generationValue);
    if (beforeSeq !== void 0) body.beforeSeq = uint64(beforeSeq);
    if (unreadBoundaryMs !== void 0) body.unreadBoundaryMs = uint64(unreadBoundaryMs);
    const data = await this.#data("GrokBotService", "ListGrokBotTranscriptEntries", body);
    data.entries ??= [];
    if (!Array.isArray(data.entries)) throw new SDKError("RPC_FAILED");
    return { generation: generation(data.generation), entries: data.entries.map(normalizeTranscriptEntry), cloudAgentPeerIds: stringList(data.cloudAgentPeerIds), cloudAgentPeerIdsKnown: data.cloudAgentPeerIdsKnown === true, unreadAnchor: normalizeUnreadAnchor(data.unreadAnchor), updatedSeqLocked: data.updatedSeqLocked === true };
  }
  async listAgentStatuses(agentIds = []) {
    const ids = botIds(agentIds, { allowEmpty: true });
    const data = await this.#data("GrokBotService", "ListGrokBotAgentStatuses", { agentIds: ids });
    data.statuses ??= [];
    if (!Array.isArray(data.statuses)) throw new SDKError("RPC_FAILED");
    return { statuses: objectRows(data.statuses).map((row) => ({ agentId: asText(row.agentId), isRunning: row.isRunning === true, live: row.live && typeof row.live === "object" && !Array.isArray(row.live) ? normalizeLiveState(row.live) : null, client: row.client && typeof row.client === "object" && !Array.isArray(row.client) ? normalizeClientState(row.client) : null })) };
  }
  async getSendStatus({ botId, messageId, sessionId = "", firstSentAgeMs, taskId } = {}) {
    botKey(botId);
    if (typeof messageId !== "string" || !messageId || typeof sessionId !== "string") throw new SDKError("MESSAGE_INVALID");
    const body = { agentId: botId, messageId, sessionId };
    if (firstSentAgeMs !== void 0) body.firstSentAgeMs = uint64(firstSentAgeMs);
    if (taskId !== void 0) {
      if (typeof taskId !== "string" || !taskId) throw new SDKError("MESSAGE_INVALID");
      body.taskId = taskId;
    }
    const data = await this.#data("GrokBotService", "GetGrokBotSendStatus", body);
    return { status: mappedEnum(data.status, SEND_STATUS), echoEntryId: typeof data.echoEntryId === "string" ? data.echoEntryId : null, rejectionCode: typeof data.rejectionCode === "string" ? data.rejectionCode : null, acceptedAtMs: msText(data.acceptedAtMs) };
  }
  async listAgentTasks({ botId, includeRecentlyDone } = {}) {
    botKey(botId);
    const body = { agentId: botId };
    if (includeRecentlyDone !== void 0) body.includeRecentlyDone = includeRecentlyDone === true;
    const data = await this.#data("GrokBotService", "ListGrokBotAgentTasks", body);
    data.tasks ??= [];
    if (!Array.isArray(data.tasks)) throw new SDKError("RPC_FAILED");
    return { tasks: objectRows(data.tasks).map((row) => ({ id: asText(row.id), name: asText(row.name), description: asText(row.description), status: asText(row.status), updatedAtMs: msText(row.updatedAtMs), unreadEntryId: typeof row.unreadEntryId === "string" ? row.unreadEntryId : null, unreadPreview: typeof row.unreadPreview === "string" ? row.unreadPreview : null, unreadAtMs: msText(row.unreadAtMs), pinnedAtMs: msText(row.pinnedAtMs), subagentIds: stringList(row.subagentIds), followed: row.followed === true })) };
  }
  async listTasks({ botId, sessionId = "" } = {}) {
    botKey(botId);
    if (typeof sessionId !== "string" || sessionId.length > 256) throw new SDKError("CURSOR_INVALID");
    const data = await this.#data("GrokBotService", "ListGrokBotTasks", { agentId: botId, sessionId });
    data.tasks ??= [];
    if (!Array.isArray(data.tasks)) throw new SDKError("RPC_FAILED");
    return { tasks: objectRows(data.tasks).map((row) => ({ id: asText(row.id), title: asText(row.title), state: wireText(row.state), note: asText(row.note), createdAtMs: msText(row.createdAtMs), doneAtMs: msText(row.doneAtMs), seenDoneAtMs: msText(row.seenDoneAtMs) })) };
  }
  async listSubagents(botId) {
    botKey(botId);
    const data = await this.#data("GrokBotService", "ListGrokBotSubagents", { agentId: botId });
    data.subagents ??= [];
    if (!Array.isArray(data.subagents)) throw new SDKError("RPC_FAILED");
    return { subagents: objectRows(data.subagents).map((row) => ({ subagentId: asText(row.subagentId), subagentType: asText(row.subagentType), title: asText(row.title), startedAtMs: msText(row.startedAtMs), freshUntilMs: msText(row.freshUntilMs) })) };
  }
  async listAgentTodos(botId) {
    botKey(botId);
    const data = await this.#data("GrokBotService", "ListGrokBotAgentTodos", { agentId: botId });
    data.todos ??= [];
    if (!Array.isArray(data.todos)) throw new SDKError("RPC_FAILED");
    return { todos: objectRows(data.todos).map((row) => ({ id: asText(row.id), content: asText(row.content), status: wireText(row.status), createdAtMs: msText(row.createdAt), updatedAtMs: msText(row.updatedAt), dependencies: stringList(row.dependencies) })) };
  }
  async listAgentSkills(botId) {
    botKey(botId);
    const data = await this.#data("GrokBotService", "ListGrokBotAgentSkills", { agentId: botId });
    data.skills ??= [];
    if (!Array.isArray(data.skills)) throw new SDKError("RPC_FAILED");
    return { skills: objectRows(data.skills).map((row) => ({ id: asText(row.id), name: asText(row.name), description: asText(row.description), body: asText(row.body), source: asText(row.source) })) };
  }
  /**
   * Read-only. Lists files on one agent.
   * `pageToken` is sent only when provided. An omitted `files` field is an empty list.
   */
  async listAgentFiles({ botId, pageToken } = {}) {
    const id = botKey(botId);
    const body = { agentId: id };
    if (pageToken !== void 0) {
      if (typeof pageToken !== "string") throw new SDKError("MESSAGE_INVALID");
      body.pageToken = pageToken;
    }
    const data = await this.#data("GrokBotService", "ListGrokBotAgentFiles", body);
    if (data.files !== void 0 && !Array.isArray(data.files)) throw new SDKError("RPC_FAILED");
    return { files: objectRows(data.files ?? []).map(normalizeAgentFile).filter(Boolean), nextPageToken: asText(data.nextPageToken), totalBytes: nonNegativeInt64(data.totalBytes), canEdit: data.canEdit === true };
  }
  async listDeletedAgentIds(agentIds = []) {
    const ids = botIds(agentIds, { allowEmpty: true });
    const data = await this.#data("GrokBotService", "ListDeletedGrokBotAgentIds", { agentIds: ids });
    data.agentIds ??= [];
    if (!Array.isArray(data.agentIds)) throw new SDKError("RPC_FAILED");
    return { agentIds: stringList(data.agentIds) };
  }
  async getRuntimeCapabilities() {
    const data = await this.#data("GrokBotService", "GetGrokBotRuntimeCapabilities", {});
    const caps = data.capabilities;
    if (!caps || typeof caps !== "object" || Array.isArray(caps)) throw new SDKError("RPC_FAILED");
    return { durableIdentityEnabled: caps.durableIdentityEnabled === true, durableIdentityWritesEnabled: caps.durableIdentityWritesEnabled === true, temporalCreationEnabled: caps.temporalCreationEnabled === true, agentMessagingEnabled: caps.agentMessagingEnabled === true, serverRoomsEnabled: caps.serverRoomsEnabled === true };
  }
  async getSandBoxRunState() {
    const data = await this.#data("GrokBotService", "GetSandBoxRunState", {});
    const image = data.image && typeof data.image === "object" && !Array.isArray(data.image) ? { registryTag: typeof data.image.registryTag === "string" ? data.image.registryTag : null, staticSnapshotPath: typeof data.image.staticSnapshotPath === "string" ? data.image.staticSnapshotPath : null } : null;
    return { runState: mappedEnum(data.state, RUN_STATE), imageUpdateAvailable: data.imageUpdateAvailable === true, egressTunnelOwnership: data.egressTunnelOwnership === true, image };
  }
  async getAgentCustomMcp({ botId, pluginId } = {}) {
    const id = botKey(botId);
    const data = await this.#data("GrokBotService", "GetGrokBotAgentCustomMcp", { agentId: id, pluginId: int64Wire(pluginId) });
    const server = normalizeCustomMcp(data.server);
    if (!server) throw new SDKError("RPC_FAILED");
    return { server };
  }
  async listAgentAccessInvites(botId) {
    const id = botKey(botId);
    const data = await this.#data("GrokBotService", "ListGrokBotAgentAccessInvites", { agentId: id });
    data.invites ??= [];
    if (!Array.isArray(data.invites)) throw new SDKError("RPC_FAILED");
    return { invites: objectRows(data.invites).map(normalizeAccessInvite), capUsage: normalizeCapUsage(data.capUsage) };
  }
  async previewAgentAccessInvite(code) {
    const data = await this.#data("GrokBotService", "PreviewGrokBotAgentAccessInvite", { code: requiredText(code) });
    return { found: data.found === true, recipientMatch: wireText(data.recipientMatch), sender: normalizeInviteSender(data.sender), invites: objectRows(data.invites).map((row) => ({ inviteId: asText(row.inviteId), bot: normalizeInviteBot(row.bot), role: asText(row.role), state: wireText(row.state), expiresAtMs: msText(row.expiresAtMs) })), truncated: data.truncated === true, otherResourceInviteCount: Number.isInteger(data.otherResourceInviteCount) ? data.otherResourceInviteCount : 0, eligibility: normalizeInviteEligibility(data.eligibility) };
  }
  /**
   * Irreversible. Deletes one bot or room.
   * `botId` is `Bot.id` (`GrokBotAgent.agentId`). The 0.78.1 client sends that value as `DeleteGrokBotAgent.id`.
   * The response message has no fields. `{id}` is the id that was sent.
   */
  async deleteBot(botId) {
    const id = botKey(botId);
    await this.#data("GrokBotService", "DeleteGrokBotAgent", { id });
    return { id };
  }
  /**
   * Irreversible. Deletes a room only when `ListGrokBotAgents` currently contains this id and its kind is ROOM.
   * Anything else throws `NOT_A_ROOM` and does not call delete.
   */
  async deleteRoom(roomId) {
    const id = botKey(roomId);
    const roster = await this.listBots();
    const room = roster.bots.find((bot) => bot.id === id);
    if (!room || !isRoomKind(room.kind)) throw new SDKError("NOT_A_ROOM");
    return this.deleteBot(id);
  }
  async createRoom({ name, memberAgentIds, description, humanMemberUserIds, agentId } = {}) {
    if (!Array.isArray(memberAgentIds)) throw new SDKError("MESSAGE_INVALID");
    const id = agentId === void 0 ? randomUUID2() : botKey(agentId);
    const data = await this.#data("GrokBotService", "CreateGrokBotRoom", { agentId: id, name: requiredText(name), description: defaultText(description), memberAgentIds: botIds(memberAgentIds, { allowEmpty: true }), humanMemberUserIds: int32List(humanMemberUserIds ?? []) });
    const bot = returnedBot(data.agent);
    if (bot.id !== id || !isRoomKind(bot.kind)) throw new SDKError("RPC_FAILED");
    return { bot };
  }
  async addRoomMembers({ roomId, userIds } = {}) {
    const id = botKey(roomId);
    const data = await this.#data("GrokBotService", "AddGrokBotRoomPeople", { agentId: id, userIds: int32List(userIds) });
    const bot = returnedBot(data.agent);
    if (bot.id !== id || !isRoomKind(bot.kind)) throw new SDKError("RPC_FAILED");
    return { bot };
  }
  /**
   * Irreversible. Removes human user ids from a room.
   * A response with no agent returns `{bot:null}`, which is what the 0.78.1 client does.
   */
  async removeRoomMembers({ roomId, userIds } = {}) {
    const id = botKey(roomId);
    const data = await this.#data("GrokBotService", "RemoveGrokBotRoomPeople", { agentId: id, userIds: int32List(userIds) });
    if (data.agent === void 0 || data.agent === null) return { bot: null };
    const bot = returnedBot(data.agent);
    if (bot.id !== id || !isRoomKind(bot.kind)) throw new SDKError("RPC_FAILED");
    return { bot };
  }
  /**
   * Irreversible. Replaces the room's bot members with `memberAgentIds`, including when that array is empty.
   */
  async setRoomMembers({ roomId, memberAgentIds } = {}) {
    const id = botKey(roomId);
    if (!Array.isArray(memberAgentIds)) throw new SDKError("MESSAGE_INVALID");
    const data = await this.#data("GrokBotService", "SetGrokBotRoomMembers", { agentId: id, memberAgentIds: botIds(memberAgentIds, { allowEmpty: true }) });
    const bot = returnedBot(data.agent);
    if (bot.id !== id || !isRoomKind(bot.kind)) throw new SDKError("RPC_FAILED");
    return { bot };
  }
  async createBot({ name, description, title, avatarShape, avatarColor, avatarDataUrl, agentId, harness, kickstartRequested, introductionSuppressed, purpose, origin, language, createIntent, createCaller, createdAutomatically, legacyAgentId } = {}) {
    const id = agentId === void 0 ? randomUUID2() : botKey(agentId);
    const body = { agentId: id, name: requiredText(name), description: defaultText(description), title: defaultText(title), avatarShape: defaultText(avatarShape), avatarColor: defaultText(avatarColor) };
    putField(body, "legacyAgentId", optionalString(legacyAgentId));
    putField(body, "avatarDataUrl", optionalString(avatarDataUrl));
    putField(body, "harness", optionalEnum(harness, HARNESS_WIRE));
    putField(body, "kickstartRequested", optionalBool(kickstartRequested));
    putField(body, "introductionSuppressed", optionalBool(introductionSuppressed));
    putField(body, "purpose", optionalString(purpose));
    putField(body, "origin", optionalString(origin));
    putField(body, "language", optionalString(language));
    putField(body, "createIntent", optionalEnum(createIntent, CREATE_INTENT_WIRE));
    putField(body, "createCaller", optionalEnum(createCaller, CREATE_CALLER_WIRE));
    putField(body, "createdAutomatically", optionalBool(createdAutomatically));
    const data = await this.#data("GrokBotService", "CreateGrokBotAgent", body);
    const bot = returnedBot(data.agent);
    if (bot.id !== id) throw new SDKError("RPC_FAILED");
    return { bot, harness: mappedEnum(data.harness, HARNESS_OUT) };
  }
  /**
   * Copies one bot. `botId` is sent as `sourceAgentId`.
   * `newBotId` is the new bot id (`agentId`). It defaults to a new UUID, the same pattern as `createRoom`.
   * Returns `{bot}` only when the server echoes that id.
   */
  async duplicateBot({ botId, newBotId } = {}) {
    const source = botKey(botId);
    const id = newBotId === void 0 ? randomUUID2() : botKey(newBotId);
    const data = await this.#data("GrokBotService", "DuplicateGrokBotAgent", { sourceAgentId: source, agentId: id });
    const bot = returnedBot(data.agent);
    if (bot.id !== id) throw new SDKError("RPC_FAILED");
    return { bot };
  }
  /**
   * Changes name, description, title, or avatar. Omitted text fields are not sent.
   * `id` is `Bot.serverId` (`GrokBotAgent.id`). The 0.78.1 client sends that value, not `Bot.id`.
   * `partialUpdate` is always true. `clearAvatar` and `avatarDataUrl` cannot be combined.
   */
  async updateBot({ id, name, description, title, avatarShape, avatarColor, avatarDataUrl, clearAvatar } = {}) {
    const recordId = botKey(id);
    if (clearAvatar !== void 0 && typeof clearAvatar !== "boolean") throw new SDKError("MESSAGE_INVALID");
    if (clearAvatar === true && avatarDataUrl !== void 0) throw new SDKError("MESSAGE_INVALID");
    const body = { id: recordId, partialUpdate: true };
    putField(body, "name", presentString(name));
    putField(body, "description", presentString(description));
    putField(body, "title", presentString(title));
    putField(body, "avatarShape", presentString(avatarShape));
    putField(body, "avatarColor", presentString(avatarColor));
    putField(body, "avatarDataUrl", optionalString(avatarDataUrl));
    if (clearAvatar === true) body.clearAvatar = {};
    if (Object.keys(body).length === 2) throw new SDKError("MESSAGE_INVALID");
    const data = await this.#data("GrokBotService", "UpdateGrokBotAgent", body);
    return { bot: returnedBot(data.agent) };
  }
  async addAgentSkill({ botId, name, description, content } = {}) {
    const id = botKey(botId);
    if (typeof content !== "string") throw new SDKError("MESSAGE_INVALID");
    const body = { agentId: id, content };
    putField(body, "name", optionalString(name));
    putField(body, "description", presentString(description));
    return skillWriteResult(await this.#data("GrokBotService", "AddGrokBotAgentSkill", body), { requireSkill: true });
  }
  async updateAgentSkill({ botId, name, description, content } = {}) {
    const id = botKey(botId);
    if (typeof content !== "string") throw new SDKError("MESSAGE_INVALID");
    const body = { agentId: id, name: requiredText(name), content };
    putField(body, "description", presentString(description));
    return skillWriteResult(await this.#data("GrokBotService", "UpdateGrokBotAgentSkill", body), { requireSkill: true });
  }
  /**
   * Irreversible. Removes one skill by name. The response has no skill record.
   */
  async removeAgentSkill({ botId, name } = {}) {
    const id = botKey(botId);
    const data = await this.#data("GrokBotService", "RemoveGrokBotAgentSkill", { agentId: id, name: requiredText(name) });
    return skillWriteResult(data, { requireSkill: false });
  }
  async *watchBot({ botId, sessionId = "", cursor, resumeFrom, signal, inlineBodyMaxBytes = 262144 } = {}) {
    botKey(botId);
    if (typeof sessionId !== "string" || sessionId.length > 256 || cursor && resumeFrom) throw new SDKError("CURSOR_INVALID");
    if (!Number.isInteger(inlineBodyMaxBytes) || inlineBodyMaxBytes < 1 || inlineBodyMaxBytes > 524288) throw new SDKError("STREAM_FRAME_TOO_LARGE");
    if (signal?.aborted) return;
    let state;
    if (resumeFrom) state = resumeCursor(resumeFrom, botId, sessionId);
    else if (cursor) state = { generation: generation(cursor.generation), afterUpdatedSeq: uint64(cursor.afterUpdatedSeq) };
    else {
      const tail = await this.#rpc("GrokBotService", "ListGrokBotTranscriptEntries", { agentId: botId, sessionId, limit: 1 }, signal);
      if (signal?.aborted) return;
      if (!tail.ok || !Array.isArray(tail.data?.entries)) throw new SDKError("RPC_FAILED", tail.httpStatus);
      state = { generation: generation(tail.data.generation), afterUpdatedSeq: tail.data.entries.reduce((max, row) => BigInt(uint64(row.updatedSeq ?? row.seq)) > BigInt(max) ? uint64(row.updatedSeq ?? row.seq) : max, "0") };
    }
    if (signal?.aborted) return;
    const control = new AbortController();
    const upstreamSignal = signal ? AbortSignal.any([signal, control.signal]) : control.signal;
    let headersTimeout = setTimeout(() => control.abort(), 2e4);
    headersTimeout.unref?.();
    try {
      const response = await (this.#options.fetchImpl ?? fetch)(`${API_ORIGIN}/aiserver.v1.GrokBotService/WatchGrokBotTranscripts`, { method: "POST", headers: { ...clientHeaders(this.#options), "content-type": "application/connect+json", "accept": "application/connect+json", "connect-accept-encoding": "identity" }, body: encodeConnectFrame({ cursors: [{ agentId: botId, sessionId, ...state }], includeUnlistedAgents: false, inlineBodyMaxBytes }), redirect: "error", signal: upstreamSignal });
      clearTimeout(headersTimeout);
      if (!response.ok) throw new SDKError("STREAM_CONNECTION_FAILED", response.status);
      if (response.headers.get("content-type")?.split(";")[0].trim() !== "application/connect+json") throw new SDKError("STREAM_INVALID_RESPONSE");
      for await (const frame of readConnectFrames(response.body, { onClose: () => control.abort() })) {
        if (signal?.aborted) return;
        if (frame.connected) yield { type: "connected", data: { serverTimeMs: String(frame.connected.serverTimeMs ?? 0), absoluteLifetimeMs: String(frame.connected.absoluteLifetimeMs ?? 0) } };
        if (frame.heartbeat) yield { type: "heartbeat", data: { serverTimeMs: String(frame.heartbeat.serverTimeMs ?? 0) } };
        const rows = frame.rows;
        if (rows?.agentId === botId && (rows.sessionId ?? "") === sessionId) {
          const nextGeneration = generation(rows.generation);
          if (nextGeneration !== state.generation) {
            state = { generation: nextGeneration, afterUpdatedSeq: "0" };
            yield { type: "reset", id: cursorID(botId, sessionId, state), data: { botId, generation: nextGeneration } };
          }
          const operations = [...(rows.entries ?? []).map((entry) => ({ entry, deleted: false, updated: uint64(entry.updatedSeq ?? entry.seq) })), ...(rows.deletes ?? []).map((entry) => ({ entry, deleted: true, updated: uint64(entry.updatedSeq ?? entry.seq) }))].sort((a, b) => BigInt(a.updated) < BigInt(b.updated) ? -1 : BigInt(a.updated) > BigInt(b.updated) ? 1 : 0);
          for (const { entry, deleted, updated } of operations) {
            if (BigInt(updated) <= BigInt(state.afterUpdatedSeq)) continue;
            state.afterUpdatedSeq = updated;
            const base = { botId, sessionId, generation: state.generation, seq: uint64(entry.seq), updatedSeq: updated, entryId: entry.entryId ?? null, replay: rows.replay === true };
            const id = cursorID(botId, sessionId, state);
            if (deleted) {
              yield { type: "message.deleted", id, data: base };
              continue;
            }
            const body = decodeEntry(entry);
            if (!body) {
              yield { type: "entry.unavailable", id, data: { ...base, entryKind: entry.entryKind ?? "", bodyOmitted: entry.bodyOmitted === true, blobHash: entry.blobHash ?? null } };
              continue;
            }
            if (body.kind === "send-message" && body.message?.type === "text" && typeof body.message.content === "string") yield { type: "message", id, data: { ...base, entryId: entry.entryId ?? body.id ?? null, operation: "upsert", text: body.message.content } };
            else yield { type: "entry", id, data: { ...base, entryKind: body.kind ?? entry.entryKind ?? "", entry: body } };
          }
        }
        if (frame.cleared?.agentId === botId && (frame.cleared.sessionId ?? "") === sessionId) {
          state = { generation: generation(frame.cleared.newGeneration), afterUpdatedSeq: "0" };
          yield { type: "reset", id: cursorID(botId, sessionId, state), data: { botId, generation: state.generation } };
        }
        if (frame.cursorTooOld?.agentId === botId && (frame.cursorTooOld.sessionId ?? "") === sessionId) {
          yield { type: "resync-required", data: { botId, generation: generation(frame.cursorTooOld.generation) } };
          return;
        }
        if (frame.turnFailed?.agentId === botId && (frame.turnFailed.sessionId ?? "") === sessionId) yield { type: "turn.failed", data: { botId, turnId: frame.turnFailed.turnId ?? "", code: frame.turnFailed.code ?? 0, summary: frame.turnFailed.summary ?? "" } };
        if (frame.agentStateChanged?.agentId === botId) yield { type: "bot.state.changed", data: { botId, families: stringList(frame.agentStateChanged.families), changedAtMs: msText(frame.agentStateChanged.changedAtMs) } };
        if (frame.rosterChanged?.agentId === botId) {
          const changed = frame.rosterChanged;
          if (!changed.agent || changed.agent.agentId === botId) yield { type: "bot.updated", data: { botId, changedFields: changed.changedFields ?? [], bot: changed.agent ? normalizeBot(changed.agent) : null } };
        }
        if (frame.agentState) {
          const live = objectRows(frame.agentState.live).filter((row) => row.agentId === botId && asText(row.sessionId) === sessionId).map(normalizeLiveState);
          const client = objectRows(frame.agentState.client).filter((row) => row.agentId === botId).map(normalizeClientState);
          if (frame.agentState.snapshot === true || live.length || client.length) yield { type: "agent.state", data: { botId, sessionId, snapshot: frame.agentState.snapshot === true, live, client } };
        }
        if (frame.computerActions) {
          const actions = objectRows(frame.computerActions.actions).filter((row) => row.agentId === botId).map(normalizeComputerAction);
          if (actions.length) yield { type: "computer.actions", data: { botId, actions } };
        }
        if (frame.boxState) yield { type: "box.state", data: { botId, snapshot: frame.boxState.snapshot === true, state: normalizeBoxState(frame.boxState.state) } };
        if (frame.pageTitleChanged) {
          const page = frame.pageTitleChanged;
          const wrapped = page.page && typeof page.page === "object" ? page.page : null;
          yield { type: "page.title.changed", data: { botId, storeId: asText(page.storeId), canvasId: wrapped?.case === "canvasId" ? asText(wrapped.value) : typeof page.canvasId === "string" ? page.canvasId : null, documentId: wrapped?.case === "documentId" ? asText(wrapped.value) : typeof page.documentId === "string" ? page.documentId : null, title: asText(page.title), changedAtMs: msText(page.changedAtMs), contentChanged: page.contentChanged === true } };
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof SDKError) throw error;
      throw new SDKError("STREAM_CONNECTION_FAILED");
    } finally {
      clearTimeout(headersTimeout);
      control.abort();
    }
  }
  botEventsSSE(options = {}) {
    const control = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, control.signal]) : control.signal;
    return eventsToSSE(this.watchBot({ ...options, signal }), { signal, keepAliveMs: options.keepAliveMs ?? 15e3, onCancel: () => control.abort() });
  }
};

// src/accounts.mjs
import { createHash as createHash2 } from "node:crypto";
import { chmod as chmod2, mkdir as mkdir2, readdir, rename, unlink as unlink2, writeFile as writeFile2 } from "node:fs/promises";
import path2 from "node:path";

// src/errors.mjs
var CliError = class extends Error {
  constructor(code, message, exitCode = 4, extra = void 0) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.extra = extra;
  }
};
var ARG_CODES = /* @__PURE__ */ new Set([
  "MESSAGE_INVALID",
  "BOT_ID_REQUIRED",
  "CURSOR_INVALID",
  "CURSOR_SCOPE_MISMATCH"
]);
function isUnauthorized(error) {
  return error instanceof SDKError && error.httpStatus === 401;
}
function normalizeError(error) {
  if (error instanceof CliError) return error;
  if (error instanceof SDKError) {
    if (error.httpStatus === 401 || error.code === "MISSING_ACCESS_TOKEN") {
      return new CliError("NOT_LOGGED_IN", "Credentials were rejected. Run: grok-bot login", 2);
    }
    if (ARG_CODES.has(error.code)) {
      return new CliError(error.code, `${error.code}. Check the command flags.`, 3);
    }
    if (error.code === "SEND_REFUSED") {
      return new CliError("SEND_REFUSED", "The server refused the message.", 4);
    }
    if (error.code === "NOT_A_ROOM") {
      return new CliError("NOT_A_ROOM", "That id is not a room.", 3);
    }
    if (error.httpStatus === 408) {
      return new CliError("TIMEOUT", "The request timed out.", 5);
    }
    if (error.code === "ACCOUNT_AUTH_FAILED") {
      return new CliError("ACCOUNT_AUTH_FAILED", "The account request was rejected.", 4);
    }
    return new CliError(error.code || "RPC_FAILED", "The request failed.", 4);
  }
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return new CliError("TIMEOUT", "The request timed out.", 5);
  }
  return new CliError("NETWORK", "The request failed.", 4);
}

// src/config.mjs
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
function pathsFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
function configDir({ platform, env, homedir: homedir2 }) {
  const { join } = pathsFor(platform);
  if (env.GROK_BOT_CONFIG_DIR) return env.GROK_BOT_CONFIG_DIR;
  if (platform === "darwin") return join(homedir2, "Library", "Application Support", "grok-bot-cli");
  if (platform === "win32") return join(env.APPDATA || join(homedir2, "AppData", "Roaming"), "grok-bot-cli");
  return join(env.XDG_CONFIG_HOME || join(homedir2, ".config"), "grok-bot-cli");
}
function credentialPath(dir, profile) {
  return path.join(dir, "profiles", `${profile}.json`);
}
function pendingPath(dir, profile) {
  return path.join(dir, "profiles", `${profile}.pending.json`);
}
async function writeSecret(file, text) {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 448 });
  try {
    await chmod(dir, 448);
  } catch {
  }
  await writeFile(file, text, { mode: 384, flag: "w" });
  try {
    await chmod(file, 384);
  } catch {
  }
}
async function readJsonFile(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return void 0;
    return null;
  }
}
async function removeFile(file) {
  try {
    await unlink(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function loadStoredSession(file) {
  const parsed = await readJsonFile(file);
  if (parsed === void 0) return null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("CREDENTIALS_INVALID", "The credential file is not valid JSON.", 2);
  }
  if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
    throw new CliError("CREDENTIALS_INVALID", "The credential file has no access token.", 2);
  }
  return {
    accessToken: parsed.accessToken,
    refreshToken: typeof parsed.refreshToken === "string" && parsed.refreshToken ? parsed.refreshToken : null,
    teamId: Number.isInteger(parsed.selectedTeamId) ? parsed.selectedTeamId : void 0,
    source: "file",
    path: file,
    refreshed: false
  };
}
function publicSession(session) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    ...session.teamId !== void 0 ? { selectedTeamId: session.teamId } : {}
  };
}

// src/accounts.mjs
var ALIAS = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function accountsPath(dir) {
  return path2.join(dir, "accounts.json");
}
function maskEmail(email) {
  if (typeof email !== "string") return "";
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return "";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain || /\s/.test(local) || /\s/.test(domain)) return "";
  return `${local.slice(0, 2)}***@${domain}`;
}
function identityHash(me) {
  const authId = typeof me?.authId === "string" ? me.authId.trim() : "";
  const userId = typeof me?.userId === "string" ? me.userId.trim() : "";
  const key = authId ? `authId:${authId}` : userId ? `userId:${userId}` : "";
  if (!key) return "";
  return createHash2("sha256").update(key).digest("hex");
}
function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.alias !== "string" || !ALIAS.test(raw.alias)) return null;
  const identity = typeof raw.identityHash === "string" && /^[a-f0-9]{64}$/.test(raw.identityHash) ? raw.identityHash : "";
  const addedAt = typeof raw.addedAt === "string" && raw.addedAt ? raw.addedAt : "";
  const lastUsedAt = typeof raw.lastUsedAt === "string" && raw.lastUsedAt ? raw.lastUsedAt : addedAt;
  if (!addedAt || !lastUsedAt) return null;
  return {
    alias: raw.alias,
    label: typeof raw.label === "string" ? raw.label : "",
    addedAt,
    lastUsedAt,
    identityHash: identity
  };
}
function parseRegistry(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.version !== 1) return null;
  if (typeof parsed.default !== "string" || !ALIAS.test(parsed.default)) return null;
  if (!Array.isArray(parsed.accounts)) return null;
  const accounts = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of parsed.accounts) {
    const row = normalizeRecord(raw);
    if (!row || seen.has(row.alias)) return null;
    seen.add(row.alias);
    accounts.push(row);
  }
  return { version: 1, default: parsed.default, accounts };
}
function serializeRegistry(registry) {
  return {
    version: 1,
    default: registry.default,
    accounts: registry.accounts.map((row) => {
      const out = {
        alias: row.alias,
        label: row.label ?? "",
        addedAt: row.addedAt,
        lastUsedAt: row.lastUsedAt
      };
      if (row.identityHash) out.identityHash = row.identityHash;
      return out;
    })
  };
}
async function writeRegistry(dir, registry) {
  const file = accountsPath(dir);
  await mkdir2(dir, { recursive: true, mode: 448 });
  try {
    await chmod2(dir, 448);
  } catch {
  }
  const tmp = path2.join(dir, `.accounts.json.${process.pid}.tmp`);
  try {
    await writeFile2(tmp, `${JSON.stringify(serializeRegistry(registry))}
`, { mode: 384, flag: "w" });
    try {
      await chmod2(tmp, 384);
    } catch {
    }
    await rename(tmp, file);
    try {
      await chmod2(file, 384);
    } catch {
    }
  } catch (error) {
    await unlink2(tmp).catch(() => {
    });
    throw error;
  }
}
async function listProfileNames(dir) {
  let names;
  try {
    names = await readdir(path2.join(dir, "profiles"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".json") && !name.endsWith(".pending.json")).map((name) => name.slice(0, -".json".length)).filter((name) => ALIAS.test(name)).sort((left, right) => left.localeCompare(right));
}
async function loadOrMigrate(dir, nowIso) {
  const parsed = await readJsonFile(accountsPath(dir));
  if (parsed === null) throw new CliError("ACCOUNTS_INVALID", "accounts.json is not valid JSON.", 3);
  if (parsed !== void 0) {
    const registry2 = parseRegistry(parsed);
    if (!registry2) throw new CliError("ACCOUNTS_INVALID", "accounts.json has an unsupported shape.", 3);
    return { ...registry2, persisted: true };
  }
  const profiles = await listProfileNames(dir);
  if (profiles.length === 0) {
    return { version: 1, default: "default", accounts: [], persisted: false };
  }
  const registry = {
    version: 1,
    default: "default",
    accounts: profiles.map((alias) => ({
      alias,
      label: "",
      addedAt: nowIso,
      lastUsedAt: nowIso,
      identityHash: ""
    })),
    persisted: true
  };
  await writeRegistry(dir, registry);
  return registry;
}

// src/exit.mjs
var hooks = /* @__PURE__ */ new Set();
var finishing = null;
function onShutdown(fn) {
  if (typeof fn !== "function") return () => {
  };
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}
function coerceCode(code) {
  const number = Number(code);
  if (!Number.isInteger(number) || number < 0 || number > 255) return 1;
  return number;
}
function flushStream(stream) {
  return new Promise((resolve2) => {
    if (!stream || typeof stream.write !== "function") {
      resolve2();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve2();
    };
    const backup = setTimeout(done, 1500);
    backup.unref?.();
    const finish = () => {
      clearTimeout(backup);
      done();
    };
    try {
      if (typeof stream.once === "function") stream.once("error", finish);
      const queued = stream.write("", finish);
      if (queued === false && typeof stream.once === "function") stream.once("drain", finish);
    } catch {
      finish();
    }
  });
}
async function destroyAgent(agent) {
  if (!agent || typeof agent !== "object") return;
  const method = typeof agent.destroy === "function" ? "destroy" : typeof agent.close === "function" ? "close" : "";
  if (!method) return;
  await Promise.race([
    Promise.resolve().then(() => agent[method]()).then(() => {
    }, () => {
    }),
    new Promise((resolve2) => {
      const timer = setTimeout(resolve2, 200);
      timer.unref?.();
    })
  ]);
}
async function closeFetchDispatcher() {
  const agents = [];
  try {
    for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
      if (String(symbol).includes("undici.globalDispatcher")) {
        const value = globalThis[symbol];
        if (value) agents.push(value);
      }
    }
  } catch {
  }
  try {
    const undici = process.getBuiltinModule?.("undici");
    if (typeof undici?.getGlobalDispatcher === "function") agents.push(undici.getGlobalDispatcher());
  } catch {
  }
  const seen = /* @__PURE__ */ new Set();
  for (const agent of agents) {
    if (seen.has(agent)) continue;
    seen.add(agent);
    await destroyAgent(agent);
  }
}
async function runHooks() {
  const list = [...hooks];
  hooks.clear();
  for (const fn of list) {
    try {
      await fn();
    } catch {
    }
  }
}
async function finishProcess(code) {
  if (finishing) return finishing;
  const exitCode = coerceCode(code);
  process.exitCode = exitCode;
  finishing = (async () => {
    const fallback = setTimeout(() => {
      Promise.resolve().then(() => flushStream(process.stdout)).then(() => flushStream(process.stderr)).finally(() => {
        process.exit(exitCode);
      });
    }, EXIT_GRACE_MS);
    fallback.unref?.();
    await runHooks();
    await closeFetchDispatcher();
    await flushStream(process.stdout);
    await flushStream(process.stderr);
  })();
  return finishing;
}

// src/help.mjs
var HELP = `grok-bot ${CLI_VERSION} (Grok Bot protocol ${TARGET_VERSION})

Usage:
  grok-bot [--json] [--account <alias>] <command> [flags]

Global flags:
  --json              Write one JSON object to stdout. Logs go to stderr.
  --account <alias>   Account to use. --profile is the same flag.
                      When both are set they must match.
                      When neither is set, the default account in accounts.json is used.
  --help, -h          Show this help.
  --version, -V       Show the CLI version, the target Grok Bot version, and the runtime.

Runtime:
  Node.js 22.13 or newer, or Bun 1.1 or newer.
  Older Node.js exits 3 with code RUNTIME_UNSUPPORTED.
  --version prints a line like "runtime node v22.20.0" or "runtime bun v1.3.10".
  With --json those are the runtime and runtimeVersion fields.

Exit codes:
  0  success
  2  not logged in, or the credentials were rejected
  3  bad arguments, or the runtime is not supported
  4  network or server error
  5  timeout

JSON errors:
  {"ok":false,"error":{"code":"...","message":"...","exitCode":3}}
  send and relay failures also include "sent": true or false.
  sent true means the message was accepted. The CLI does not send it again.

Credentials:
  macOS    ~/Library/Application Support/grok-bot-cli/profiles/<alias>.json
  Linux    \${XDG_CONFIG_HOME:-~/.config}/grok-bot-cli/profiles/<alias>.json
  Windows  %APPDATA%\\grok-bot-cli\\profiles\\<alias>.json
  Accounts ~/.../grok-bot-cli/accounts.json
           { version, default, accounts: [{ alias, label, addedAt, lastUsedAt }] }
           label is a masked email. Tokens are not stored in this file.
  The first run copies existing profile names into accounts.json.
  The default account is "default" when that file is created from old profiles.
  Override the directory with GROK_BOT_CONFIG_DIR.
  Override the access token of the selected account with GROK_BOT_ACCESS_TOKEN.
  Files are mode 0600 where the platform allows it. Tokens are never printed.

Commands:
  login [--start | --wait] [--no-open] [--timeout <seconds>]
      Browser login. The default opens the URL and polls until approval.
      --start prints loginUrl and expiresAt, saves the pending login, and returns.
      --wait resumes that pending login. Default wait is ${LOGIN_WAIT_SEC}s.
      --start default lifetime is ${START_TTL_SEC}s.
      --no-open does not launch a browser (macOS open, Linux xdg-open, Windows start).

  logout
      Delete the saved credentials and any pending login for the selected account.
      The account stays registered. accounts remove also drops the registration.

  status [--all-accounts]
      Show whether a credential is stored and a non-sensitive account summary.
      --all-accounts asks every registered account. One failure does not hide the others.

  accounts list [--check]
  accounts add <alias> [--start | --wait] [--no-open] [--timeout <seconds>]
  accounts use <alias>
  accounts rename <old> <new>
  accounts remove <alias>
      list prints alias, masked label, default, credential presence, and source.
      --check calls getMe on each account and reports ok or an error code per account.
      add is login for that alias. The same identity cannot be stored twice.
      use selects the default account. rename also renames the credential file.
      remove deletes the credential and the registration.

  bots [--all-accounts]
  sessions --bot <ref>
  transcript --bot <ref> [--session <id>] [--limit <n>]
  tasks --bot <ref> [--session <id>]
  todos --bot <ref>
  skills --bot <ref>
  capabilities
  box
      Read-only views. A ref is an id, an exact name, a unique partial name,
      or alias:id-or-name when that alias is registered.
      Without --account, an unprefixed ref is resolved across logged-in accounts.
      bots --all-accounts reads every registered account in parallel.

  send --bot <ref> --text <text> [--session <id>] [--file <path>...]
       [--wait] [--timeout <seconds>] [--idle-timeout <seconds>]
      Send a message. --file passes attachment paths through the SDK.
      --wait watches the bot until the turn goes idle, then prints the reply.
      Default --timeout is ${DEFAULT_TIMEOUT_SEC}s. The maximum is ${MAX_TIMEOUT_SEC}s.
      Default --idle-timeout is ${DEFAULT_IDLE_SEC}s.
      endedBy is agent-idle when the event stream goes busy and then idle,
      or status-idle when a status check says the bot is not running.
      Text that arrives while the bot is still running is not the final reply.
      On timeout the message stays sent. Continue with wait --message-id.

  wait --bot <ref> --message-id <id> [--session <id>] [--timeout <seconds>] [--idle-timeout <seconds>]
      Keep waiting for a message that was already sent. This does not send again.
      Default --timeout is ${DEFAULT_TIMEOUT_SEC}s (maximum ${MAX_TIMEOUT_SEC}s).
      It first reads the transcript. A complete reply is assistant text, including
      a send-message entry, after that message and before the next role=user message.
      Otherwise it watches for new text.

  relay --from <ref> --to <ref> --text <text> [--template <text>] [--rounds <n>]
        [--timeout <seconds>] [--idle-timeout <seconds>] [--dry-run]
      Send --text to --from, then forward the reply to --to. One round is that pair.
      --rounds is 1 to ${MAX_RELAY_ROUNDS}, default 1. Each step uses the same
      default timeout, ${DEFAULT_TIMEOUT_SEC}s. This is not a background forwarder.
      The template defaults to {reply} and may also include {fromName} and {fromAccount}.
      --dry-run resolves both bots and prints the first message. It does not send.

  watch --bot <ref> [--bot <ref>...] [--session <id>]
      Stream events until the server closes or the process is interrupted.
      Each --bot can belong to a different account. Lines are merged.
      With --json, stdout is NDJSON: {"ok":true,"account":"...","botId":"...","event":{...}}

  files --bot <ref> [--page-token <token>]
  invites --bot <ref>
      Read-only. files lists the bot's files. invites lists access invites.
      --page-token is sent only when you pass it.

  bot create --name <name> [--description <text>] [--title <text>]
  bot update --bot <ref> [--name <name>] [--description <text>] [--title <text>]
  bot duplicate --bot <ref> [--name <name>]
  bot delete --bot <ref> [--yes]
      create uses the selected account. update sends Bot.serverId, not Bot.id.
      duplicate copies Bot.id. With --name, the copy is renamed afterward.
      A copy keeps the description and settings. It does not keep chat history
      or the avatar. delete is irreversible. Without --yes it prints the target
      and does not delete.

  room create --name <name> [--description <text>] --member <ref> [--member <ref>...]
  room add-member --room <ref> --user-id <id> [--user-id <id>...]
  room delete --room <ref> [--yes]
  room remove-member --room <ref> --user-id <id>... [--yes]
  room set-members --room <ref> --member <ref>... [--yes]
      --room uses the same ref rules as --bot and the record must be a room.
      Members are resolved to Bot.id and must use the same account as the room.
      delete, remove-member, and set-members are irreversible. Without --yes
      they print the target and do not write. set-members replaces bot members.

  skill add --bot <ref> --name <name> (--content <text> | --content-file <path>) [--description <text>]
  skill update --bot <ref> --name <name> (--content <text> | --content-file <path>) [--description <text>]
  skill remove --bot <ref> --name <name> [--yes]
      Pass skill text with --content or --content-file, not both.
      remove is irreversible. Without --yes it does not remove the skill.

  bot delete, room delete, room remove-member, room set-members, and skill remove
  reject a partial name. Pass an id or the full name. There is no restore command.

A saved refresh token is renewed with the desktop client's OAuth refresh request
when it is close to expiry or a call returns HTTP 401. An environment token is
not refreshed. A rejected refresh asks you to login again (exit 2).
`;

// src/match.mjs
function matchBot(bots, query, { exact = false } = {}) {
  const needle = query.trim();
  const folded = needle.toLowerCase();
  const byId = bots.filter((bot) => bot.id === needle);
  if (byId.length === 1) return { bot: byId[0] };
  if (byId.length > 1) return { ambiguous: byId };
  const byName = bots.filter((bot) => bot.name.toLowerCase() === folded);
  if (byName.length === 1) return { bot: byName[0] };
  if (byName.length > 1) return { ambiguous: byName };
  const partial = bots.filter((bot) => bot.name.toLowerCase().includes(folded));
  if (exact) {
    if (partial.length) return { ambiguous: partial, inexact: true };
    return { none: true };
  }
  if (partial.length === 1) return { bot: partial[0] };
  if (partial.length > 1) return { ambiguous: partial };
  return { none: true };
}

// src/redact.mjs
var SECRET_KEY = /^(access[_-]?token|refresh[_-]?token|verifier|authorization|gateway[_-]?token|network[_-]?token|password|secret)$/i;
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item);
  }
  return out;
}

// src/refresh.mjs
function jwtExpMs(token) {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp * 1e3 : null;
  } catch {
    return null;
  }
}
function shouldRefreshAccessToken(accessToken, now) {
  const exp = jwtExpMs(accessToken);
  if (exp == null) return true;
  return exp - now < REFRESH_SKEW_MS;
}
async function refreshSession(ctx, session) {
  if (!session.refreshToken || session.source !== "file") {
    throw new CliError("NOT_LOGGED_IN", "Credentials were rejected. Run: grok-bot login", 2);
  }
  let response;
  try {
    response = await ctx.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: session.refreshToken
      })
    });
  } catch {
    throw new CliError("NETWORK", "Could not reach the token endpoint.", 4);
  }
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new CliError("AUTH_REFRESH_FAILED", "The token endpoint returned an unreadable body. Run: grok-bot login", 2);
  }
  if (data?.shouldLogout === true) {
    await removeFile(session.path);
    throw new CliError("AUTH_REVOKED", "The session was revoked. Run: grok-bot login", 2);
  }
  if (!response.ok || typeof data?.access_token !== "string" || !data.access_token) {
    throw new CliError("AUTH_REFRESH_FAILED", "The access token could not be refreshed. Run: grok-bot login", 2);
  }
  const next = {
    ...session,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : session.refreshToken,
    source: "file",
    refreshed: true
  };
  await writeSecret(session.path, `${JSON.stringify(publicSession(next))}
`);
  return next;
}

// src/reply.mjs
function seqValue(entry) {
  try {
    return BigInt(entry?.seq ?? 0);
  } catch {
    return 0n;
  }
}
function bodyOf(entry) {
  const body = entry?.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}
function entryPlainText(entry) {
  const body = bodyOf(entry);
  if (!body) return "";
  if (typeof body.content === "string") return body.content;
  if (typeof body.text === "string") return body.text;
  if (typeof body.message?.content === "string") return body.message.content;
  return "";
}
function isStreaming(entry) {
  const body = bodyOf(entry);
  if (!body) return false;
  return body.streaming === true || body.isStreaming === true || body.message?.streaming === true || body.message?.isStreaming === true;
}
function idMatches(value, messageId, echoEntryId) {
  return typeof value === "string" && value.length > 0 && (value === messageId || echoEntryId && value === echoEntryId);
}
function entryReferencesMessage(entry, messageId, echoEntryId = null) {
  const body = bodyOf(entry);
  return idMatches(entry?.entryId, messageId, echoEntryId) || idMatches(body?.id, messageId, echoEntryId) || idMatches(body?.messageId, messageId, echoEntryId) || idMatches(body?.clientMessageId, messageId, echoEntryId) || idMatches(body?.message?.id, messageId, echoEntryId) || idMatches(body?.message?.messageId, messageId, echoEntryId);
}
function entryKindText(entry) {
  const body = bodyOf(entry);
  return `${entry?.entryKind || ""} ${body?.kind || ""}`.toLowerCase();
}
function isUserTurn(entry) {
  const body = bodyOf(entry);
  if (!body) return false;
  if (entryKindText(entry).includes("send-message")) return false;
  const role = String(body.role || body.message?.role || "").toLowerCase();
  return role === "user";
}
function isAssistantEntry(entry) {
  if (isUserTurn(entry)) return false;
  const body = bodyOf(entry);
  const kind = String(body?.kind || entry?.entryKind || "").toLowerCase();
  const role = String(body?.role || body?.message?.role || "").toLowerCase();
  if (kind.includes("send-message")) return true;
  if (role === "assistant") return true;
  if (kind === "assistant-text" || kind === "assistant" || kind === "assistant-message") return true;
  if (kind === "message" && role !== "user") return true;
  return false;
}
function findReplyAfterMessage(entries, messageId, { echoEntryId = null } = {}) {
  const sorted = [...Array.isArray(entries) ? entries : []].sort((left, right) => {
    const a = seqValue(left);
    const b = seqValue(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  const anchorIndex = sorted.findIndex((entry) => entryReferencesMessage(entry, messageId, echoEntryId));
  if (anchorIndex < 0) return { foundAnchor: false, complete: false, text: "", anchorText: "" };
  const anchorText = entryPlainText(sorted[anchorIndex]).trim();
  const texts = [];
  let streaming = false;
  for (const entry of sorted.slice(anchorIndex + 1)) {
    if (isUserTurn(entry) && !entryReferencesMessage(entry, messageId, echoEntryId)) break;
    if (!isAssistantEntry(entry)) continue;
    if (isStreaming(entry)) {
      streaming = true;
      continue;
    }
    const text = entryPlainText(entry).trim();
    if (text && text !== anchorText) texts.push(text);
  }
  if (streaming || texts.length === 0) {
    return { foundAnchor: true, complete: false, text: "", anchorText };
  }
  return { foundAnchor: true, complete: true, text: texts.join("\n\n"), anchorText };
}

// src/runtime.mjs
var MIN_NODE_VERSION = "22.13.0";
var MIN_BUN_VERSION = "1.1.0";
function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), match[3] === void 0 ? 0 : Number(match[3])];
}
function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}
function detectRuntime(versions = process.versions) {
  if (typeof versions?.bun === "string" && versions.bun) return { name: "bun", version: versions.bun };
  if (typeof versions?.node === "string" && versions.node) return { name: "node", version: versions.node };
  return { name: "unknown", version: "0.0.0" };
}
function formatRuntimeVersion(version) {
  const text = String(version ?? "0.0.0");
  return text.startsWith("v") ? text : `v${text}`;
}
function formatRuntimeLine(runtime) {
  return `runtime ${runtime.name} ${formatRuntimeVersion(runtime.version)}`;
}
function unsupportedRuntime(runtime) {
  const parsed = parseVersion(runtime?.version);
  if (runtime?.name === "node" && parsed && compareVersions(parsed, parseVersion(MIN_NODE_VERSION)) >= 0) return null;
  if (runtime?.name === "bun" && parsed && compareVersions(parsed, parseVersion(MIN_BUN_VERSION)) >= 0) return null;
  const seen = `${runtime?.name ?? "unknown"} ${formatRuntimeVersion(runtime?.version)}`;
  if (runtime?.name === "node") {
    return `Node.js ${formatRuntimeVersion(runtime.version)} is too old. Install Node.js 22 LTS (22.13 or newer) or Bun.`;
  }
  return `This runtime is not supported (${seen}). Install Node.js 22 LTS (22.13 or newer) or Bun 1.1 or newer.`;
}

// src/wait.mjs
function rowActive(row) {
  return row?.isRunning === true || row?.isComposingMessage === true || row?.isRetrying === true || row?.hasRunningSubagents === true;
}
function agentIsRunning(statuses, botId) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const row = rows.find((item) => item?.agentId === botId);
  if (!row) return false;
  if (row.isRunning === true) return true;
  return rowActive(row.live);
}
function createTurnWait({ timeoutMs, idleMs, userText, startedAt, probeIntervalMs = STATUS_PROBE_INTERVAL_MS }) {
  const texts = /* @__PURE__ */ new Map();
  const order = [];
  const state = {
    active: false,
    sawActive: false,
    idleSince: null,
    lastTextAt: null,
    failure: null,
    statusRunning: null,
    lastProbeAt: null,
    finalProbeDone: false
  };
  const user = String(userText ?? "").trim();
  function note(id, text, streaming2, now) {
    const key = id || `text-${order.length + 1}`;
    if (!texts.has(key)) order.push(key);
    texts.set(key, { text, streaming: streaming2 });
    state.lastTextAt = now;
    state.statusRunning = null;
  }
  function joined() {
    return order.map((id) => texts.get(id).text).join("\n\n");
  }
  function streaming() {
    for (const item of texts.values()) if (item.streaming) return true;
    return false;
  }
  function apply(event, now) {
    if (event?.type === "turn.failed") {
      state.failure = event.data ?? {};
      return;
    }
    if (event?.type === "agent.state") {
      const live = Array.isArray(event.data?.live) ? event.data.live : [];
      const snapshot = event.data?.snapshot === true;
      if (!live.length && !snapshot) return;
      const active = live.some(rowActive);
      state.active = active;
      if (active) {
        state.sawActive = true;
        state.idleSince = null;
        state.statusRunning = null;
      } else if (state.idleSince == null) state.idleSince = now;
      return;
    }
    if (event?.type === "message") {
      if (event.data?.replay === true) return;
      const text = event.data?.text;
      if (typeof text !== "string" || !text.trim() || text.trim() === user) return;
      note(event.data.entryId || event.id, text, false, now);
      return;
    }
    if (event?.type === "entry") {
      if (event.data?.replay === true) return;
      const entry = event.data?.entry;
      if (!entry || typeof entry !== "object") return;
      const kind = String(entry.kind || event.data?.entryKind || "").toLowerCase();
      if (kind !== "message" && !kind.includes("send-message")) return;
      if (entry.role === "user" || entry.message?.role === "user") return;
      const text = typeof entry.content === "string" ? entry.content : typeof entry.text === "string" ? entry.text : typeof entry.message?.content === "string" ? entry.message.content : "";
      if (!text.trim() || text.trim() === user) return;
      const streaming2 = entry.streaming === true || entry.isStreaming === true || entry.message?.streaming === true || entry.message?.isStreaming === true;
      note(event.data.entryId || entry.id, text, streaming2, now);
    }
  }
  function decide(now) {
    if (state.failure) {
      return { done: true, ok: false, reason: "turn-failed", text: joined(), summary: String(state.failure.summary ?? ""), failureCode: state.failure.code ?? "" };
    }
    const text = joined();
    const quietFor = state.lastTextAt == null ? null : now - state.lastTextAt;
    const idleFor = state.idleSince == null ? null : now - state.idleSince;
    const quietEnough = Boolean(text) && quietFor != null && quietFor >= idleMs;
    const timedOut = now >= startedAt + timeoutMs;
    if (state.sawActive && !state.active && text && !streaming() && quietEnough && idleFor != null && idleFor >= idleMs) {
      return { done: true, ok: true, reason: "agent-idle", text };
    }
    if (state.statusRunning === false && text && (state.finalProbeDone || quietEnough)) {
      return { done: true, ok: true, reason: "status-idle", text };
    }
    if (timedOut && (!text || state.finalProbeDone)) {
      return { done: true, ok: false, reason: "timeout", text };
    }
    const eventSettling = state.sawActive && !state.active && text && !streaming() && state.idleSince != null;
    const probeDue = quietEnough && !eventSettling && (state.lastProbeAt == null || now - state.lastProbeAt >= probeIntervalMs);
    if (probeDue && !state.finalProbeDone) return { probe: true, final: false };
    if (timedOut && text && !state.finalProbeDone) return { probe: true, final: true };
    return null;
  }
  return {
    push(event, now) {
      apply(event, now);
      return decide(now);
    },
    poll(now) {
      return decide(now);
    },
    noteStatus(running, now, options = {}) {
      state.lastProbeAt = now;
      if (options.final === true) state.finalProbeDone = true;
      if (options.failed === true) state.statusRunning = null;
      else state.statusRunning = running === true;
      return decide(now);
    },
    nextWait(now) {
      const untilTimeout = startedAt + timeoutMs - now;
      if (untilTimeout <= 0) return 0;
      const text = joined();
      if (!text || state.lastTextAt == null) return untilTimeout;
      const quietFor = now - state.lastTextAt;
      const quietLeft = idleMs - quietFor;
      if (state.sawActive && !state.active && !streaming() && state.idleSince != null) {
        const idleLeft = idleMs - (now - state.idleSince);
        const wait = Math.max(quietLeft, idleLeft);
        if (wait > 0) return Math.min(untilTimeout, wait);
      }
      if (quietLeft > 0) return Math.min(untilTimeout, quietLeft);
      if (state.statusRunning === false) return untilTimeout;
      const probeLeft = state.lastProbeAt == null ? 0 : probeIntervalMs - (now - state.lastProbeAt);
      return Math.max(0, Math.min(untilTimeout, probeLeft));
    },
    finish(reason, now) {
      const decision = decide(now);
      if (decision) return decision;
      const text = joined();
      if (reason === "timeout") {
        if (text && !state.finalProbeDone) return { probe: true, final: true };
        return { done: true, ok: false, reason: "timeout", text };
      }
      if (state.statusRunning === false && text) return { done: true, ok: true, reason: "status-idle", text };
      if (text && !state.finalProbeDone) return { probe: true, final: true };
      return { done: true, ok: false, reason: "stream-closed", text };
    },
    forceClosed() {
      const text = joined();
      if (state.statusRunning === false && text) return { done: true, ok: true, reason: "status-idle", text };
      return { done: true, ok: false, reason: "stream-closed", text };
    },
    forceTimeout() {
      return { done: true, ok: false, reason: "timeout", text: joined() };
    }
  };
}

// src/cli.mjs
var execFileAsync = promisify(execFile);
async function defaultOpen(url, platform) {
  if (platform === "darwin") await execFileAsync("/usr/bin/open", [url]);
  else if (platform === "win32") await execFileAsync("cmd.exe", ["/c", "start", "", url]);
  else await execFileAsync("xdg-open", [url]);
}
function createQueue() {
  const items = [];
  let pending = null;
  let timer = null;
  let closed = false;
  let failure = null;
  const deliver = (result) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const resolve2 = pending;
    pending = null;
    resolve2?.(result);
  };
  return {
    push(value) {
      if (closed) return;
      if (pending) deliver({ value });
      else items.push(value);
    },
    close(error) {
      if (closed) return;
      closed = true;
      failure = error ?? null;
      if (pending) deliver(failure ? { error: failure } : { done: true });
    },
    cancel() {
      this.close();
    },
    next(ms) {
      if (items.length) return Promise.resolve({ value: items.shift() });
      if (closed) return Promise.resolve(failure ? { error: failure } : { done: true });
      return new Promise((resolve2) => {
        pending = resolve2;
        timer = setTimeout(() => {
          timer = null;
          pending = null;
          resolve2({ timeout: true });
        }, Math.max(0, ms));
      });
    },
    drain() {
      return items.splice(0, items.length);
    }
  };
}
function writeJson(ctx, value) {
  ctx.stdout.write(`${JSON.stringify(redact(value))}
`);
}
function asCliError(error) {
  return error instanceof CliError ? error : normalizeError(error);
}
function fail(ctx, error) {
  const normalized = asCliError(error);
  const exitCode = normalized.exitCode ?? 4;
  const extra = { ...normalized.extra ?? {} };
  delete extra.exitCode;
  if (ctx.json) writeJson(ctx, { ok: false, error: { code: normalized.code, message: normalized.message, ...extra, exitCode } });
  else ctx.stderr.write(`${normalized.code}: ${normalized.message}
`);
  return exitCode;
}
function ok(ctx, payload, human) {
  if (ctx.json) writeJson(ctx, { ok: true, ...payload });
  else if (human != null) ctx.stdout.write(human.endsWith("\n") ? human : `${human}
`);
  return 0;
}
function clientFor(ctx, session) {
  return new GrokBotClient({
    accessToken: session.accessToken,
    fetchImpl: ctx.fetchImpl,
    version: TARGET_VERSION,
    ...session.teamId !== void 0 ? { teamId: session.teamId } : {}
  });
}
function envToken(ctx) {
  const token = ctx.env.GROK_BOT_ACCESS_TOKEN;
  return typeof token === "string" && token ? token : "";
}
function bindAccount(ctx, alias) {
  ctx.account = alias;
  ctx.profile = alias;
  ctx.credentialFile = credentialPath(ctx.configDirectory, alias);
  ctx.pendingFile = pendingPath(ctx.configDirectory, alias);
}
async function registryOf(ctx) {
  if (!ctx.registry) ctx.registry = await loadOrMigrate(ctx.configDirectory, new Date(ctx.now()).toISOString());
  return ctx.registry;
}
async function persistRegistry(ctx) {
  const registry = await registryOf(ctx);
  ctx.registrySave = (ctx.registrySave ?? Promise.resolve()).then(() => writeRegistry(ctx.configDirectory, registry));
  await ctx.registrySave;
  registry.persisted = true;
}
async function touchAccount(ctx, alias) {
  const registry = await registryOf(ctx);
  const row = registry.accounts.find((item) => item.alias === alias);
  if (!row || !registry.persisted && registry.accounts.length === 0) return;
  row.lastUsedAt = new Date(ctx.now()).toISOString();
  await persistRegistry(ctx);
}
async function rememberAccount(ctx, alias, fields = {}) {
  const registry = await registryOf(ctx);
  const now = new Date(ctx.now()).toISOString();
  let row = registry.accounts.find((item) => item.alias === alias);
  if (!row) {
    row = { alias, label: "", addedAt: now, lastUsedAt: now, identityHash: "" };
    registry.accounts.push(row);
  }
  if (fields.label) row.label = fields.label;
  if (fields.identityHash) row.identityHash = fields.identityHash;
  row.lastUsedAt = now;
  if (fields.makeDefault) registry.default = alias;
  await persistRegistry(ctx);
  return registry;
}
async function sessionFor(ctx, alias) {
  const file = credentialPath(ctx.configDirectory, alias);
  if (envToken(ctx) && alias === ctx.account) {
    return { accessToken: envToken(ctx), refreshToken: null, teamId: void 0, source: "env", path: file, refreshed: true };
  }
  return loadStoredSession(file);
}
async function prepareSessionFor(ctx, alias) {
  const session = await sessionFor(ctx, alias);
  const file = credentialPath(ctx.configDirectory, alias);
  if (!session) throw new CliError("NOT_LOGGED_IN", "Not logged in. Run: grok-bot login", 2, { profile: alias, credentialPath: file });
  if (session.source === "file" && session.refreshToken && shouldRefreshAccessToken(session.accessToken, ctx.now())) {
    try {
      return await refreshSession(ctx, session);
    } catch (error) {
      if (error instanceof CliError && error.code === "NETWORK") {
        ctx.stderr.write("Token refresh failed. Trying the saved access token.\n");
        return session;
      }
      throw error;
    }
  }
  return session;
}
async function withAccount(ctx, alias, fn) {
  let session = await prepareSessionFor(ctx, alias);
  const run = (current) => fn(clientFor(ctx, current), current);
  let result;
  try {
    result = await run(session);
  } catch (error) {
    if (!isUnauthorized(error) || session.source !== "file" || !session.refreshToken || session.refreshed) throw error;
    session = await refreshSession(ctx, session);
    result = await run(session);
  }
  await touchAccount(ctx, alias);
  return result;
}
function labelFor(registry, alias) {
  return registry.accounts.find((row) => row.alias === alias)?.label ?? "";
}
async function registeredAliases(ctx) {
  const registry = await registryOf(ctx);
  const aliases = registry.accounts.map((row) => row.alias);
  if (envToken(ctx) && !aliases.includes(ctx.account)) aliases.push(ctx.account);
  return aliases;
}
function rosterFor(ctx, alias) {
  if (!ctx.rosters) ctx.rosters = /* @__PURE__ */ new Map();
  if (!ctx.rosters.has(alias)) {
    ctx.rosters.set(alias, withAccount(ctx, alias, (client) => client.listBots()));
  }
  return ctx.rosters.get(alias);
}
function parseBotRef(query, aliases) {
  const text = String(query ?? "");
  const index = text.indexOf(":");
  if (index <= 0) return { account: null, query: text };
  const alias = text.slice(0, index);
  if (!aliases.has(alias)) return { account: null, query: text };
  return { account: alias, query: text.slice(index + 1) };
}
function candidateOf(account, bot) {
  return { account, id: bot.id, name: bot.name };
}
async function searchableAliases(ctx) {
  const names = await registeredAliases(ctx);
  const targets = [];
  for (const alias of names) {
    if (envToken(ctx) && alias === ctx.account) {
      targets.push(alias);
      continue;
    }
    const parsed = await readJsonFile(credentialPath(ctx.configDirectory, alias));
    if (parsed === void 0) continue;
    targets.push(alias);
  }
  return targets;
}
var ROOM_KINDS = /* @__PURE__ */ new Set(["2", "ROOM", "GROK_BOT_AGENT_KIND_ROOM"]);
function isRoomKind2(kind) {
  return ROOM_KINDS.has(String(kind ?? ""));
}
async function resolveBot(ctx, query, options = {}) {
  const exact = options.exact === true;
  const requireRoom = options.requireRoom === true;
  const registry = await registryOf(ctx);
  const aliases = new Set(registry.accounts.map((row) => row.alias));
  const ref = parseBotRef(query, aliases);
  if (ref.account && !ref.query) throw new CliError("USAGE", "Bot reference is missing a name after the account prefix.", 3);
  if (ctx.accountExplicit && ref.account && ref.account !== ctx.account) {
    throw new CliError("USAGE", `Bot account "${ref.account}" does not match --account ${ctx.account}.`, 3);
  }
  const scoped = ctx.accountExplicit || Boolean(ref.account);
  const targets = scoped ? [ref.account || ctx.account] : await searchableAliases(ctx);
  if (!targets.length) {
    throw new CliError("NOT_LOGGED_IN", "Not logged in. Run: grok-bot login", 2, {
      profile: ctx.account,
      credentialPath: credentialPath(ctx.configDirectory, ctx.account)
    });
  }
  const hits = [];
  const failures = [];
  await Promise.all(targets.map(async (alias) => {
    try {
      const roster = await rosterFor(ctx, alias);
      const match = matchBot(roster.bots, ref.query, { exact });
      if (match.bot) hits.push({ account: alias, bot: match.bot, inexact: false });
      else if (match.ambiguous) {
        for (const bot of match.ambiguous) hits.push({ account: alias, bot, inexact: match.inexact === true });
      }
    } catch (error) {
      const normalized = asCliError(error);
      failures.push({ account: alias, code: normalized.code, message: normalized.message, exitCode: normalized.exitCode ?? 4 });
    }
  }));
  hits.sort((left, right) => left.account.localeCompare(right.account) || left.bot.name.localeCompare(right.bot.name) || left.bot.id.localeCompare(right.bot.id));
  const exactHits = hits.filter((hit) => !hit.inexact);
  const chosen = exactHits.length ? exactHits : hits;
  const noun = requireRoom ? "room" : "bot";
  if (hits.length && !exactHits.length) {
    const candidates = hits.map((hit) => candidateOf(hit.account, hit.bot));
    throw new CliError("AMBIGUOUS_BOT", `"${query}" is not an exact ${noun} id or full name. Pass an id or the full name. Matched: ${candidates.map((item) => `${item.account}:${item.name} (${item.id})`).join(", ")}.`, 3, { candidates });
  }
  if (chosen.length === 1) {
    if (!scoped) {
      for (const failure of failures) ctx.stderr.write(`Skipping account ${failure.account}: ${failure.code}
`);
    }
    const resolved = { account: chosen[0].account, bot: chosen[0].bot };
    if (requireRoom && !isRoomKind2(resolved.bot.kind)) {
      throw new CliError("NOT_A_ROOM", `"${resolved.bot.name}" (${resolved.bot.id}) is not a room.`, 3, {
        account: resolved.account,
        id: resolved.bot.id,
        name: resolved.bot.name,
        kind: resolved.bot.kind
      });
    }
    return resolved;
  }
  if (chosen.length > 1) {
    const candidates = chosen.map((hit) => candidateOf(hit.account, hit.bot));
    const example = `${candidates[0].account}:${candidates[0].name}`;
    const hint = exact ? `Pass ${requireRoom ? "a room" : "a bot"} id or the full name.` : `Pass a bot id or an account prefix such as ${example}.`;
    throw new CliError("AMBIGUOUS_BOT", `Multiple ${noun}s match "${query}": ${candidates.map((item) => `${item.account}:${item.name} (${item.id})`).join(", ")}. ${hint}`, 3, { candidates });
  }
  if (failures.length && (scoped || targets.length === 1)) {
    const failure = failures[0];
    throw new CliError(failure.code, failure.message, failure.exitCode, { account: failure.account });
  }
  if (failures.length) {
    const listed = failures.map((failure) => `${failure.account} (${failure.code})`).join(", ");
    throw new CliError("BOT_NOT_FOUND", `No bot matches "${query}". These accounts could not be searched: ${listed}.`, 3, {
      failedAccounts: failures.map((failure) => ({ account: failure.account, code: failure.code }))
    });
  }
  throw new CliError("BOT_NOT_FOUND", `No bot matches "${query}".`, 3);
}
async function withBot(ctx, query, fn, options) {
  const resolved = await resolveBot(ctx, query, options);
  return withAccount(ctx, resolved.account, (client, session) => fn(client, session, resolved));
}
async function resolveMembers(ctx, refs, { exact = false, account = null } = {}) {
  const resolved = [];
  for (const ref of refs) {
    const hit = await resolveBot(ctx, ref, { exact });
    if (account && hit.account !== account) {
      throw new CliError("USAGE", `Member "${hit.bot.name}" is on account "${hit.account}", not "${account}". Room members must use the same account.`, 3);
    }
    resolved.push(hit);
  }
  if (!account && resolved.length > 1) {
    const owner = resolved[0].account;
    const other = resolved.find((hit) => hit.account !== owner);
    if (other) {
      throw new CliError("USAGE", `Room members must use the same account. "${resolved[0].bot.name}" is on "${owner}" and "${other.bot.name}" is on "${other.account}".`, 3);
    }
  }
  return resolved;
}
function managedBot(bot) {
  return {
    id: bot.id,
    serverId: bot.serverId ?? null,
    name: bot.name,
    title: bot.title ?? "",
    kind: bot.kind ?? "",
    role: bot.role ?? ""
  };
}
function requireServerId(bot) {
  if (typeof bot.serverId !== "string" || !bot.serverId) {
    throw new CliError("USAGE", `Bot "${bot.name}" (${bot.id}) has no server id, so it cannot be updated.`, 3);
  }
  return bot.serverId;
}
function publicSkill(skill) {
  if (!skill) return null;
  return {
    name: skill.name ?? "",
    description: skill.description ?? "",
    sourcePath: skill.sourcePath ?? ""
  };
}
function dryRun(ctx, action, fields) {
  const id = fields.botId || fields.roomId || "";
  const name = fields.botName || fields.roomName || "";
  const kind = fields.kind ? ` ${fields.kind}` : "";
  return ok(ctx, { dryRun: true, action, ...fields }, `dry-run ${action} ${fields.account} ${name} (${id})${kind}`);
}
async function readSkillContent(flags) {
  if (flags.content != null) return flags.content;
  const path3 = resolve(flags.contentFile);
  try {
    return await readFile2(path3, "utf8");
  } catch {
    throw new CliError("FILE_NOT_FOUND", `Cannot read skill content ${flags.contentFile}`, 3);
  }
}
function renderTemplate(template, vars) {
  return String(template).replace(/\{(reply|fromName|fromAccount)\}/g, (match, key) => vars[key] ?? match);
}
function withoutExit(row) {
  const { exitCode: _exitCode, ...rest } = row;
  return rest;
}
function finishFanout(ctx, accounts, extra, human) {
  const failed = accounts.filter((row) => row.ok === false);
  const body = { ...extra, accounts: accounts.map(withoutExit) };
  if (accounts.length > 0 && failed.length === accounts.length) {
    const first = failed[0];
    const exitCode = first.exitCode ?? 4;
    if (ctx.json) {
      writeJson(ctx, { ok: false, error: { code: first.error.code, message: first.error.message, exitCode }, ...body });
    } else {
      if (human) ctx.stdout.write(human.endsWith("\n") ? human : `${human}
`);
      ctx.stderr.write(`${first.error.code}: ${first.error.message}
`);
    }
    return exitCode;
  }
  return ok(ctx, body, human);
}
function entryText(entry) {
  const body = entry?.body;
  if (!body || typeof body !== "object") return null;
  if (typeof body.content === "string") return body.content;
  if (typeof body.message?.content === "string") return body.message.content;
  return null;
}
function summarizeBot(bot) {
  return { id: bot.id, name: bot.name, title: bot.title, kind: bot.kind, role: bot.role, sessionId: bot.sessionId };
}
function accountSummary(me) {
  return {
    identityPresent: Boolean(me?.authId || me?.userId),
    emailPresent: Boolean(me?.email),
    namePresent: Boolean(me?.name || me?.displayName),
    teamPresent: me?.teamId !== void 0 && me?.teamId !== null
  };
}
async function openLogin(ctx, loginUrl) {
  if (ctx.noOpen) return;
  try {
    await ctx.openBrowser(loginUrl);
  } catch {
    ctx.stderr.write("Could not open a browser. Open the login URL yourself.\n");
  }
}
async function savePending(ctx, flow, expiresAt) {
  await writeSecret(ctx.pendingFile, `${JSON.stringify({
    uuid: flow.uuid,
    verifier: flow.verifier,
    loginUrl: flow.loginUrl,
    expiresAt: new Date(expiresAt).toISOString(),
    profile: ctx.profile
  })}
`);
}
async function loadPending(ctx) {
  const parsed = await readJsonFile(ctx.pendingFile);
  if (parsed === void 0) throw new CliError("LOGIN_NOT_STARTED", "No pending login. Run: grok-bot login --start", 3);
  if (!parsed || typeof parsed.uuid !== "string" || typeof parsed.verifier !== "string" || typeof parsed.loginUrl !== "string") {
    throw new CliError("LOGIN_NOT_STARTED", "The pending login is invalid. Run: grok-bot login --start", 3);
  }
  const expiresAt = Date.parse(parsed.expiresAt);
  return { uuid: parsed.uuid, verifier: parsed.verifier, loginUrl: parsed.loginUrl, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}
async function pollUntilApproved(ctx, flow, { timeoutMs, expiresAt }) {
  const deadline = ctx.now() + timeoutMs;
  if (expiresAt != null && ctx.now() >= expiresAt) {
    throw new CliError("LOGIN_EXPIRED", "The pending login expired. Run: grok-bot login --start", 2);
  }
  try {
    return await pollLogin(flow, {
      fetchImpl: ctx.fetchImpl,
      maxAttempts: 1e6,
      sleep: async (milliseconds) => {
        if (expiresAt != null && ctx.now() >= expiresAt) throw new CliError("LOGIN_EXPIRED", "The pending login expired. Run: grok-bot login --start", 2);
        if (ctx.now() >= deadline) throw new CliError("LOGIN_TIMED_OUT", `Login timed out after ${Math.round(timeoutMs / 1e3)}s.`, 5);
        const cap = Math.min(milliseconds, deadline - ctx.now(), expiresAt == null ? milliseconds : expiresAt - ctx.now());
        if (cap <= 0) {
          if (expiresAt != null && expiresAt <= deadline) throw new CliError("LOGIN_EXPIRED", "The pending login expired. Run: grok-bot login --start", 2);
          throw new CliError("LOGIN_TIMED_OUT", `Login timed out after ${Math.round(timeoutMs / 1e3)}s.`, 5);
        }
        await ctx.sleep(cap);
      },
      onPending: (attempt) => {
        if (attempt === 1 || attempt % 5 === 0) ctx.stderr.write(`Waiting for browser approval (attempt ${attempt}).
`);
      }
    });
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error?.message === "SIGN_IN_POLICY_VIOLATION") throw new CliError("SIGN_IN_POLICY_VIOLATION", "Sign-in was refused by organization policy.", 2);
    if (error?.message === "LOGIN_TIMED_OUT") throw new CliError("LOGIN_TIMED_OUT", "Login timed out.", 5);
    throw new CliError("LOGIN_POLL_FAILED", "The login poll failed.", 4);
  }
}
async function findIdentityClash(ctx, hash, alias) {
  if (!hash) return "";
  const registry = await registryOf(ctx);
  for (const row of registry.accounts) {
    if (row.alias !== alias && row.identityHash && row.identityHash === hash) return row.alias;
  }
  for (const row of registry.accounts) {
    if (row.alias === alias || row.identityHash) continue;
    try {
      const me = await withAccount(ctx, row.alias, (client) => client.getMe());
      const other = identityHash(me);
      if (!other) continue;
      row.identityHash = other;
      const label = maskEmail(me?.email);
      if (label && !row.label) row.label = label;
      await persistRegistry(ctx);
      if (other === hash) return row.alias;
    } catch {
    }
  }
  return "";
}
async function commitLogin(ctx, session) {
  const record = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    ...session.selectedTeamId !== void 0 ? { selectedTeamId: session.selectedTeamId } : {}
  };
  if (typeof record.accessToken !== "string" || typeof record.refreshToken !== "string") {
    throw new CliError("LOGIN_POLL_FAILED", "The login response did not include credentials.", 4);
  }
  let label = "";
  let hash = "";
  try {
    const me = await clientFor(ctx, {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      teamId: session.selectedTeamId,
      source: "memory",
      path: ctx.credentialFile,
      refreshed: true
    }).getMe();
    label = maskEmail(me?.email);
    hash = identityHash(me);
  } catch {
    ctx.stderr.write("Could not read an account label.\n");
  }
  if (hash) {
    const clash = await findIdentityClash(ctx, hash, ctx.account);
    if (clash) {
      await removeFile(ctx.pendingFile);
      throw new CliError("ACCOUNT_ALREADY_ADDED", `This account is already added as ${clash}.`, 3, { alias: clash, account: clash });
    }
  }
  await writeSecret(ctx.credentialFile, `${JSON.stringify(record)}
`);
  await removeFile(ctx.pendingFile);
  const registry = await rememberAccount(ctx, ctx.account, { label, identityHash: hash });
  return ok(ctx, {
    profile: ctx.profile,
    account: ctx.account,
    defaultAccount: registry.default,
    credentialPath: ctx.credentialFile,
    accessTokenPresent: true,
    refreshTokenPresent: true,
    selectedTeamIdPresent: session.selectedTeamId !== void 0,
    label
  }, `Saved credentials for account ${ctx.account}
${ctx.credentialFile}`);
}
async function commandLogin(ctx, flags) {
  const timeoutSec = flags.timeout ?? (flags.start ? START_TTL_SEC : LOGIN_WAIT_SEC);
  const timeoutMs = timeoutSec * 1e3;
  if (flags.wait) {
    const pending = await loadPending(ctx);
    const session2 = await pollUntilApproved(ctx, pending, { timeoutMs, expiresAt: pending.expiresAt });
    return commitLogin(ctx, session2);
  }
  const flow = createLogin();
  const expiresAt = ctx.now() + timeoutMs;
  await savePending(ctx, flow, expiresAt);
  const payload = { loginUrl: flow.loginUrl, expiresAt: new Date(expiresAt).toISOString(), profile: ctx.profile };
  if (flags.start) {
    await openLogin(ctx, flow.loginUrl);
    return ok(ctx, payload, `Login URL:
${flow.loginUrl}
Expires: ${payload.expiresAt}`);
  }
  if (ctx.json) ctx.stderr.write(`Login URL: ${flow.loginUrl}
Expires: ${payload.expiresAt}
`);
  else ctx.stdout.write(`Login URL:
${flow.loginUrl}
Expires: ${payload.expiresAt}
`);
  await openLogin(ctx, flow.loginUrl);
  const session = await pollUntilApproved(ctx, flow, { timeoutMs, expiresAt });
  return commitLogin(ctx, session);
}
async function credentialState(ctx, alias) {
  const file = credentialPath(ctx.configDirectory, alias);
  try {
    const session = await loadStoredSession(file);
    if (!session) return { credentials: false, source: "missing", file };
    return { credentials: true, source: "file", file };
  } catch (error) {
    if (error instanceof CliError && error.code === "CREDENTIALS_INVALID") return { credentials: false, source: "invalid", file };
    throw error;
  }
}
async function commandAccountsList(ctx, flags) {
  const registry = await registryOf(ctx);
  const rows = await Promise.all(registry.accounts.map(async (row) => {
    const state = await credentialState(ctx, row.alias);
    const item = {
      alias: row.alias,
      label: row.label ?? "",
      default: row.alias === registry.default,
      credentials: state.credentials,
      source: state.source
    };
    if (!flags.check) return { item };
    if (!state.credentials) {
      const code = state.source === "invalid" ? "CREDENTIALS_INVALID" : "NOT_LOGGED_IN";
      return { item: { ...item, check: { ok: false, code } } };
    }
    try {
      const me = await withAccount(ctx, row.alias, (client) => client.getMe());
      const label = maskEmail(me?.email);
      const hash = identityHash(me);
      if (label) item.label = label;
      return { item: { ...item, check: { ok: true } }, label, hash, alias: row.alias };
    } catch (error) {
      return { item: { ...item, check: { ok: false, code: asCliError(error).code } } };
    }
  }));
  let changed = false;
  for (const row of rows) {
    if (!row.hash && !row.label) continue;
    const stored = registry.accounts.find((item) => item.alias === row.alias);
    if (!stored) continue;
    if (row.label && stored.label !== row.label) {
      stored.label = row.label;
      changed = true;
    }
    if (row.hash && stored.identityHash !== row.hash) {
      stored.identityHash = row.hash;
      changed = true;
    }
  }
  if (changed) await persistRegistry(ctx);
  const accounts = rows.map((row) => row.item);
  const lines = accounts.map((row) => `${row.default ? "*" : " "} ${row.alias}	${row.label}	${row.source}	credentials=${row.credentials}${row.check ? `	${row.check.ok ? "ok" : row.check.code}` : ""}`).join("\n");
  return ok(ctx, { default: registry.default, accounts }, lines || "(no accounts)");
}
async function commandAccountsUse(ctx, alias) {
  const registry = await registryOf(ctx);
  const known = registry.accounts.some((row) => row.alias === alias);
  const state = await credentialState(ctx, alias);
  if (!known && state.source === "missing") throw new CliError("ACCOUNT_NOT_FOUND", `No account named ${alias}.`, 3);
  const next = await rememberAccount(ctx, alias, { makeDefault: true });
  return ok(ctx, { account: alias, default: next.default }, `Default account is ${alias}`);
}
async function commandAccountsRename(ctx, previous, next) {
  if (previous === next) throw new CliError("USAGE", "accounts rename needs two different aliases", 3);
  const registry = await registryOf(ctx);
  const fromCred = credentialPath(ctx.configDirectory, previous);
  const toCred = credentialPath(ctx.configDirectory, next);
  const fromPending = pendingPath(ctx.configDirectory, previous);
  const toPending = pendingPath(ctx.configDirectory, next);
  const known = registry.accounts.some((row2) => row2.alias === previous);
  const previousState = await credentialState(ctx, previous);
  const pendingExists = await readJsonFile(fromPending) !== void 0;
  if (!known && previousState.source === "missing" && !pendingExists) throw new CliError("ACCOUNT_NOT_FOUND", `No account named ${previous}.`, 3);
  if (registry.accounts.some((row2) => row2.alias === next)) throw new CliError("ACCOUNT_EXISTS", `Account ${next} already exists.`, 3);
  if (await readJsonFile(toCred) !== void 0 || await readJsonFile(toPending) !== void 0) {
    throw new CliError("ACCOUNT_EXISTS", `Account ${next} already exists.`, 3);
  }
  if (previousState.source !== "missing") await rename2(fromCred, toCred);
  if (pendingExists) await rename2(fromPending, toPending);
  const row = registry.accounts.find((item) => item.alias === previous);
  if (row) row.alias = next;
  else registry.accounts.push({ alias: next, label: "", addedAt: new Date(ctx.now()).toISOString(), lastUsedAt: new Date(ctx.now()).toISOString(), identityHash: "" });
  if (registry.default === previous) registry.default = next;
  await persistRegistry(ctx);
  if (ctx.account === previous) bindAccount(ctx, next);
  return ok(ctx, { account: next, previous, default: registry.default }, `Renamed ${previous} to ${next}`);
}
async function commandAccountsRemove(ctx, alias) {
  const registry = await registryOf(ctx);
  const known = registry.accounts.some((row) => row.alias === alias);
  const removedCredential = await removeFile(credentialPath(ctx.configDirectory, alias));
  const removedPending = await removeFile(pendingPath(ctx.configDirectory, alias));
  if (!known && !removedCredential && !removedPending) throw new CliError("ACCOUNT_NOT_FOUND", `No account named ${alias}.`, 3);
  registry.accounts = registry.accounts.filter((row) => row.alias !== alias);
  if (registry.default === alias) {
    const remaining = [...registry.accounts].sort((left, right) => left.alias.localeCompare(right.alias));
    registry.default = remaining[0]?.alias ?? "default";
  }
  await persistRegistry(ctx);
  return ok(ctx, { account: alias, removed: true, default: registry.default }, `Removed account ${alias}`);
}
async function commandAccounts(ctx, flags) {
  const [sub, ...rest] = flags.args ?? [];
  if (sub === "list") return commandAccountsList(ctx, flags);
  if (sub === "add") {
    bindAccount(ctx, rest[0]);
    ctx.accountExplicit = true;
    return commandLogin(ctx, flags);
  }
  if (sub === "use") return commandAccountsUse(ctx, rest[0]);
  if (sub === "rename") return commandAccountsRename(ctx, rest[0], rest[1]);
  if (sub === "remove") return commandAccountsRemove(ctx, rest[0]);
  throw new CliError("USAGE", "accounts requires list, add, use, rename, or remove", 3);
}
async function commandLogout(ctx) {
  const removedCredential = await removeFile(ctx.credentialFile);
  const removedPending = await removeFile(ctx.pendingFile);
  return ok(ctx, {
    profile: ctx.profile,
    credentialPath: ctx.credentialFile,
    removed: removedCredential || removedPending
  }, removedCredential || removedPending ? `Removed credentials for profile ${ctx.profile}` : `Profile ${ctx.profile} was already logged out`);
}
async function commandStatus(ctx, flags) {
  if (flags?.allAccounts) return commandStatusAll(ctx);
  return withAccount(ctx, ctx.account, async (client, session) => {
    const me = await client.getMe();
    const summary = accountSummary(me);
    return ok(ctx, {
      loggedIn: true,
      profile: ctx.profile,
      source: session.source,
      credentialPath: session.path,
      account: summary
    }, [
      "loggedIn: true",
      `profile: ${ctx.profile}`,
      `source: ${session.source}`,
      `credentialPath: ${session.path}`,
      `identityPresent: ${summary.identityPresent}`,
      `emailPresent: ${summary.emailPresent}`,
      `namePresent: ${summary.namePresent}`,
      `teamPresent: ${summary.teamPresent}`
    ].join("\n"));
  });
}
async function commandStatusAll(ctx) {
  const registry = await registryOf(ctx);
  const aliases = await registeredAliases(ctx);
  const accounts = await Promise.all(aliases.map(async (alias) => {
    const label = labelFor(registry, alias);
    const state = await credentialState(ctx, alias);
    try {
      return await withAccount(ctx, alias, async (client, session) => {
        const summary = accountSummary(await client.getMe());
        return {
          account: alias,
          label,
          ok: true,
          loggedIn: true,
          source: session.source,
          credentialPath: session.path,
          ...summary
        };
      });
    } catch (error) {
      const normalized = asCliError(error);
      return {
        account: alias,
        label,
        ok: false,
        loggedIn: false,
        source: state.source === "file" ? "file" : state.source,
        credentialPath: state.file,
        exitCode: normalized.exitCode ?? 4,
        error: { code: normalized.code, message: normalized.message }
      };
    }
  }));
  const lines = accounts.map((row) => row.ok ? `${row.account}	loggedIn	${row.source}` : `${row.account}	${row.error.code}`).join("\n");
  return finishFanout(ctx, accounts, {}, lines || "(no accounts)");
}
async function commandBots(ctx, flags) {
  if (flags?.allAccounts) return commandBotsAll(ctx);
  return withAccount(ctx, ctx.account, async (client) => {
    const roster = await client.listBots();
    const bots = roster.bots.map(summarizeBot);
    const lines = bots.map((bot) => `${bot.id}	${bot.name}	${bot.role}	${bot.sessionId}`).join("\n");
    return ok(ctx, { account: ctx.account, count: bots.length, truncated: roster.truncated, bots }, lines || "(no bots)");
  });
}
async function commandBotsAll(ctx) {
  const registry = await registryOf(ctx);
  const aliases = await registeredAliases(ctx);
  const accounts = await Promise.all(aliases.map(async (alias) => {
    const label = labelFor(registry, alias);
    const state = await credentialState(ctx, alias);
    if (state.source === "missing" && !(envToken(ctx) && alias === ctx.account)) {
      return {
        account: alias,
        label,
        ok: false,
        count: 0,
        truncated: false,
        exitCode: 2,
        error: { code: "NOT_LOGGED_IN", message: "Not logged in. Run: grok-bot login" }
      };
    }
    try {
      const roster = await rosterFor(ctx, alias);
      const bots2 = roster.bots.map((bot) => ({ account: alias, ...summarizeBot(bot) }));
      return {
        account: alias,
        label,
        ok: true,
        count: bots2.length,
        truncated: roster.truncated,
        bots: bots2
      };
    } catch (error) {
      const normalized = asCliError(error);
      return {
        account: alias,
        label,
        ok: false,
        count: 0,
        truncated: false,
        exitCode: normalized.exitCode ?? 4,
        error: { code: normalized.code, message: normalized.message }
      };
    }
  }));
  const bots = accounts.flatMap((row) => row.bots ?? []);
  const publicAccounts = accounts.map(({ bots: _bots, ...row }) => row);
  const lines = [
    ...publicAccounts.map((row) => row.ok ? `${row.account}	${row.count}	truncated=${row.truncated}` : `${row.account}	${row.error.code}`),
    ...bots.map((bot) => `${bot.account}	${bot.id}	${bot.name}	${bot.role}	${bot.sessionId}`)
  ].join("\n");
  return finishFanout(ctx, publicAccounts, { bots }, lines || "(no accounts)");
}
async function commandSessions(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listSessions(resolved.bot.id);
    const lines = result.sessions.map((session) => `${session.sessionId}	${session.kind}	${session.lastActivityAtMs ?? ""}`).join("\n");
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: result.sessions.length, sessions: result.sessions }, lines || "(no sessions)");
  });
}
async function commandTranscript(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listTranscript({ botId: resolved.bot.id, sessionId: flags.session ?? "", limit: flags.limit ?? 20 });
    const entries = result.entries.map((entry) => ({
      seq: entry.seq,
      updatedSeq: entry.updatedSeq,
      entryId: entry.entryId,
      entryKind: entry.entryKind,
      bodyOmitted: entry.bodyOmitted,
      text: entryText(entry)
    }));
    const lines = entries.map((entry) => `[${entry.seq}] ${entry.entryKind}
${entry.text ?? ""}`).join("\n");
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, generation: result.generation, count: entries.length, unreadAnchor: result.unreadAnchor, entries }, lines || "(no entries)");
  });
}
async function commandTasks(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const [agentTasks, tasks] = await Promise.all([
      client.listAgentTasks({ botId: resolved.bot.id }),
      client.listTasks({ botId: resolved.bot.id, sessionId: flags.session ?? "" })
    ]);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      agentTasks: agentTasks.tasks,
      tasks: tasks.tasks
    }, `agentTasks: ${agentTasks.tasks.length}
tasks: ${tasks.tasks.length}`);
  });
}
async function commandTodos(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentTodos(resolved.bot.id);
    const lines = result.todos.map((todo) => `${todo.status}	${todo.content}`).join("\n");
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: result.todos.length, todos: result.todos }, lines || "(no todos)");
  });
}
async function commandSkills(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentSkills(resolved.bot.id);
    const skills = result.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, source: skill.source, body: skill.body }));
    const lines = skills.map((skill) => `${skill.name}	${skill.source}`).join("\n");
    return ok(ctx, { account: resolved.account, botId: resolved.bot.id, count: skills.length, skills }, lines || "(no skills)");
  });
}
async function commandCapabilities(ctx) {
  return withAccount(ctx, ctx.account, async (client) => {
    const capabilities = await client.getRuntimeCapabilities();
    return ok(ctx, { account: ctx.account, capabilities }, Object.entries(capabilities).map(([key, value]) => `${key}: ${value}`).join("\n"));
  });
}
async function commandBox(ctx) {
  return withAccount(ctx, ctx.account, async (client) => {
    const box = await client.getSandBoxRunState();
    return ok(ctx, { account: ctx.account, box }, `runState: ${box.runState}
imageUpdateAvailable: ${box.imageUpdateAvailable}`);
  });
}
async function attachmentArgs(files) {
  const paths = [];
  for (const file of files) {
    const path3 = resolve(file);
    try {
      await access(path3, constants.R_OK);
    } catch {
      throw new CliError("FILE_NOT_FOUND", `Cannot read attachment ${file}`, 3);
    }
    paths.push(path3);
  }
  return { attachmentPaths: paths, attachmentNames: paths.map((file) => basename(file)) };
}
function publicEvent(event) {
  return { type: event.type, ...event.id !== void 0 ? { id: event.id } : {}, data: event.data };
}
function formatEvent(event) {
  if (event.type === "message") return `message ${event.data?.text ?? ""}`;
  if (event.type === "turn.failed") return `turn.failed ${event.data?.summary ?? ""}`;
  if (event.type === "agent.state") {
    const live = event.data?.live?.[0];
    if (!live) return "agent.state";
    return `agent.state running=${live.isRunning} composing=${live.isComposingMessage}`;
  }
  return event.type;
}
async function pump(iterator, queue) {
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        queue.close();
        return;
      }
      queue.push(next.value);
    }
  } catch (error) {
    queue.close(error);
  }
}
function replyTimeoutMessage(account, bot, messageId) {
  return `Timed out waiting for the reply. The message was sent. Continue with: grok-bot wait --bot ${account}:${bot.id} --message-id ${messageId}`;
}
function invalidatesStatus(event, userText) {
  const user = String(userText ?? "").trim();
  if (event?.type === "agent.state") {
    const live = Array.isArray(event.data?.live) ? event.data.live : [];
    return live.some((row) => row?.isRunning === true || row?.isComposingMessage === true || row?.isRetrying === true || row?.hasRunningSubagents === true);
  }
  if (event?.type === "message") {
    if (event.data?.replay === true) return false;
    const text = event.data?.text;
    return typeof text === "string" && text.trim() && text.trim() !== user;
  }
  if (event?.type === "entry") {
    if (event.data?.replay === true) return false;
    const entry = event.data?.entry;
    if (!entry || typeof entry !== "object") return false;
    const kind = String(entry.kind || event.data?.entryKind || "").toLowerCase();
    if (kind !== "message" && !kind.includes("send-message")) return false;
    if (entry.role === "user" || entry.message?.role === "user") return false;
    const text = typeof entry.content === "string" ? entry.content : typeof entry.message?.content === "string" ? entry.message.content : "";
    return Boolean(text.trim()) && text.trim() !== user;
  }
  return false;
}
async function waitForReply(ctx, client, bot, flags, onSent) {
  const timeoutMs = (flags.timeout ?? DEFAULT_TIMEOUT_SEC) * 1e3;
  const idleMs = (flags.idleTimeout ?? DEFAULT_IDLE_SEC) * 1e3;
  const sessionId = flags.session ?? "";
  const sending = flags.sending !== false;
  const userText = flags.userText ?? flags.text ?? "";
  const abort = new AbortController();
  const iterator = client.watchBot({ botId: bot.id, sessionId, signal: abort.signal })[Symbol.asyncIterator]();
  const queue = createQueue();
  const pumping = pump(iterator, queue);
  const deadline = ctx.now() + timeoutMs;
  const buffered = [];
  let sent = null;
  const stop = () => {
    abort.abort();
    queue.cancel();
  };
  const unregister = onShutdown(stop);
  try {
    let connected = false;
    while (!connected) {
      const remaining = deadline - ctx.now();
      if (remaining <= 0) throw new CliError("STREAM_CONNECTION_FAILED", "Timed out waiting for the bot event stream.", 4, { sent: false });
      const item = await queue.next(remaining);
      if (item.error) throw item.error;
      if (item.done) throw new CliError("STREAM_CONNECTION_FAILED", "The bot event stream closed before it connected.", 4, { sent: false });
      if (item.timeout) continue;
      buffered.push(item.value);
      if (item.value?.type === "connected") connected = true;
    }
    if (!sending && flags.recheck) {
      const transcript = await client.listTranscript({ botId: bot.id, sessionId, limit: WAIT_TRANSCRIPT_LIMIT });
      const found = findReplyAfterMessage(transcript.entries, flags.messageId, { echoEntryId: flags.echoEntryId ?? null });
      if (found.complete) return { sent: null, decision: { ok: true, text: found.text, reason: "transcript" } };
    }
    if (sending) {
      const attachments = await attachmentArgs(flags.file ?? []);
      sent = await client.sendMessage({
        botId: bot.id,
        text: flags.text,
        sessionId,
        ...attachments
      });
      onSent?.(sent);
    }
    const waiter = createTurnWait({
      timeoutMs,
      idleMs,
      userText,
      startedAt: ctx.now(),
      probeIntervalMs: STATUS_PROBE_INTERVAL_MS
    });
    const accept = (decision) => {
      if (!decision?.done) return null;
      if (!decision.ok) {
        const code = decision.reason === "timeout" ? "TIMEOUT" : decision.reason === "turn-failed" ? "TURN_FAILED" : "STREAM_CLOSED";
        const exitCode = decision.reason === "timeout" ? 5 : 4;
        const message = decision.reason === "turn-failed" ? `The turn failed${decision.summary ? `: ${decision.summary}` : "."}` : decision.reason === "timeout" ? sent ? replyTimeoutMessage(flags.account ?? ctx.account, bot, sent.messageId) : "Timed out waiting for the reply." : "The event stream closed before a reply.";
        throw new CliError(code, message, exitCode, {
          text: decision.text,
          endedBy: decision.reason,
          botId: bot.id,
          account: flags.account ?? ctx.account,
          ...sent ? { messageId: sent.messageId, sent: true } : { sent: false }
        });
      }
      return decision;
    };
    const fold = (events) => {
      for (const event of events) waiter.push(event, ctx.now());
      for (const extra of queue.drain()) waiter.push(extra, ctx.now());
    };
    async function catchUp() {
      let empty = 0;
      for (let i = 0; i < 40 && empty < 8; i += 1) {
        const extra = queue.drain();
        if (extra.length) {
          for (const event of extra) waiter.push(event, ctx.now());
          empty = 0;
        } else {
          empty += 1;
          await Promise.resolve();
        }
      }
    }
    async function resolveDecision(decision) {
      let current = decision;
      let spins = 0;
      while (current?.probe) {
        spins += 1;
        if (spins > 8) {
          current = waiter.forceTimeout();
          break;
        }
        await catchUp();
        current = waiter.poll(ctx.now());
        if (!current?.probe) break;
        const final = current.final === true;
        let running = true;
        let failed = false;
        try {
          const statuses = await client.listAgentStatuses([bot.id]);
          running = agentIsRunning(statuses.statuses, bot.id);
        } catch (error) {
          if (isUnauthorized(error)) throw error;
          failed = true;
        }
        const now = ctx.now();
        const during = queue.drain();
        let stale = false;
        let early = null;
        for (const event of during) {
          if (invalidatesStatus(event, userText)) stale = true;
          const pushed = waiter.push(event, now);
          if (pushed?.done && !pushed.ok) early = pushed;
          else if (pushed?.done && pushed.ok && !early) early = pushed;
        }
        if (early?.done) {
          current = early;
          break;
        }
        current = waiter.noteStatus(running, now, { final, failed: failed || stale });
      }
      return current;
    }
    fold(buffered);
    while (true) {
      const ready = accept(await resolveDecision(waiter.poll(ctx.now())));
      if (ready) return { sent, decision: ready };
      const remaining = deadline - ctx.now();
      if (remaining <= 0) {
        let finished = await resolveDecision(waiter.finish("timeout", ctx.now()));
        if (!finished?.done) finished = waiter.forceTimeout();
        return { sent, decision: accept(finished) };
      }
      const waitMs = Math.min(remaining, waiter.nextWait(ctx.now()));
      const item = await queue.next(Math.max(0, waitMs));
      if (item.error) throw item.error;
      if (item.done) {
        let finished = await resolveDecision(waiter.finish("stream-closed", ctx.now()));
        if (!finished?.done) finished = waiter.forceClosed();
        return { sent, decision: accept(finished) };
      }
      if (item.value) fold([item.value]);
    }
  } finally {
    unregister();
    stop();
    const closing = (async () => {
      await iterator.return?.().catch(() => {
      });
      await pumping.catch(() => {
      });
    })();
    closing.catch(() => {
    });
    await Promise.race([closing, delay2(100)]);
  }
}
function attachSent(error, sent) {
  const normalized = asCliError(error);
  return new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
    ...normalized.extra,
    sent: normalized.extra?.sent ?? sent
  });
}
async function commandSend(ctx, flags) {
  let committed = false;
  try {
    const resolved = await resolveBot(ctx, flags.bot);
    return await withAccount(ctx, resolved.account, async (client) => {
      if (committed) {
        throw new CliError("WATCH_AFTER_SEND_FAILED", "The message was sent, but waiting for the reply failed.", 4, {
          sent: true,
          account: resolved.account,
          botId: resolved.bot.id
        });
      }
      const sessionId = flags.session ?? "";
      if (!flags.wait) {
        const attachments = await attachmentArgs(flags.file);
        const sent2 = await client.sendMessage({ botId: resolved.bot.id, text: flags.text, sessionId, ...attachments });
        committed = true;
        return ok(ctx, {
          account: resolved.account,
          botId: sent2.botId,
          messageId: sent2.messageId,
          delivery: sent2.delivery,
          dispatched: sent2.dispatched
        }, `sent ${sent2.botId} ${sent2.messageId} ${sent2.delivery}`);
      }
      const { sent, decision } = await waitForReply(ctx, client, resolved.bot, {
        text: flags.text,
        timeout: flags.timeout,
        idleTimeout: flags.idleTimeout,
        session: sessionId,
        file: flags.file,
        account: resolved.account
      }, () => {
        committed = true;
      });
      if (!ctx.json) ctx.stderr.write(`endedBy ${decision.reason}
`);
      return ok(ctx, {
        account: resolved.account,
        botId: sent.botId,
        messageId: sent.messageId,
        delivery: sent.delivery,
        dispatched: sent.dispatched,
        text: decision.text,
        endedBy: decision.reason
      }, decision.text);
    });
  } catch (error) {
    throw attachSent(error, committed);
  }
}
async function commandWait(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const sessionId = flags.session ?? "";
    let echoEntryId = null;
    try {
      const status = await client.getSendStatus({ botId: resolved.bot.id, messageId: flags.messageId, sessionId });
      echoEntryId = status.echoEntryId;
    } catch (error) {
      if (isUnauthorized(error)) throw error;
      const normalized = asCliError(error);
      if (normalized.exitCode === 3) throw normalized;
    }
    const transcript = await client.listTranscript({ botId: resolved.bot.id, sessionId, limit: WAIT_TRANSCRIPT_LIMIT });
    const found = findReplyAfterMessage(transcript.entries, flags.messageId, { echoEntryId });
    if (found.complete) {
      if (!ctx.json) ctx.stderr.write("endedBy transcript\n");
      return ok(ctx, {
        account: resolved.account,
        botId: resolved.bot.id,
        messageId: flags.messageId,
        text: found.text,
        endedBy: "transcript"
      }, found.text);
    }
    const { decision } = await waitForReply(ctx, client, resolved.bot, {
      sending: false,
      recheck: true,
      messageId: flags.messageId,
      echoEntryId,
      userText: found.anchorText,
      timeout: flags.timeout,
      idleTimeout: flags.idleTimeout,
      session: sessionId,
      account: resolved.account
    });
    if (!ctx.json) ctx.stderr.write(`endedBy ${decision.reason}
`);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      messageId: flags.messageId,
      text: decision.text,
      endedBy: decision.reason
    }, decision.text);
  });
}
async function commandRelay(ctx, flags) {
  try {
    const from = await resolveBot(ctx, flags.from);
    const to = await resolveBot(ctx, flags.to);
    const template = flags.template ?? "{reply}";
    if (flags.dryRun) {
      return ok(ctx, {
        dryRun: true,
        from: { account: from.account, botId: from.bot.id, botName: from.bot.name },
        to: { account: to.account, botId: to.bot.id, botName: to.bot.name },
        text: flags.text,
        template
      }, `from ${from.account}:${from.bot.name} (${from.bot.id})
to ${to.account}:${to.bot.name} (${to.bot.id})
${flags.text}`);
    }
    const rounds = flags.rounds ?? 1;
    const steps = [];
    const sequence = [];
    for (let round = 0; round < rounds; round += 1) sequence.push(from, to);
    let previous = null;
    for (let index = 0; index < sequence.length; index += 1) {
      const target = sequence[index];
      const text = index === 0 ? flags.text : renderTemplate(template, {
        reply: previous.text,
        fromName: previous.bot.name,
        fromAccount: previous.account
      });
      let committed = false;
      try {
        const result = await withAccount(ctx, target.account, async (client) => {
          if (committed) {
            throw new CliError("WATCH_AFTER_SEND_FAILED", "The message was sent, but waiting for the reply failed.", 4, { sent: true });
          }
          return waitForReply(ctx, client, target.bot, {
            text,
            timeout: flags.timeout,
            idleTimeout: flags.idleTimeout,
            session: "",
            file: [],
            account: target.account
          }, () => {
            committed = true;
          });
        });
        const row = {
          step: index + 1,
          account: target.account,
          botId: target.bot.id,
          botName: target.bot.name,
          sent: true,
          messageId: result.sent.messageId,
          text: result.decision.text,
          endedBy: result.decision.reason
        };
        steps.push(row);
        previous = { account: target.account, bot: target.bot, text: result.decision.text };
      } catch (error) {
        const normalized = asCliError(error);
        throw new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
          ...normalized.extra,
          sent: normalized.extra?.sent ?? committed,
          completedSteps: steps.slice()
        });
      }
    }
    const lines = steps.map((step) => `${step.step}	${step.account}	${step.botName}
${step.text}`).join("\n");
    return ok(ctx, { steps }, lines);
  } catch (error) {
    const normalized = asCliError(error);
    throw new CliError(normalized.code, normalized.message, normalized.exitCode ?? 4, {
      ...normalized.extra,
      sent: normalized.extra?.sent ?? false,
      completedSteps: normalized.extra?.completedSteps ?? []
    });
  }
}
async function commandWatch(ctx, flags) {
  const queries = flags.bots?.length ? flags.bots : [flags.bot];
  const resolved = [];
  for (const query of queries) resolved.push({ ...await resolveBot(ctx, query), query });
  const abort = new AbortController();
  const onSigint = () => abort.abort();
  process.on("SIGINT", onSigint);
  const unregister = onShutdown(() => abort.abort());
  let writeChain = Promise.resolve();
  const writeLine = (line) => {
    writeChain = writeChain.then(() => {
      ctx.stdout.write(line);
    });
    return writeChain;
  };
  try {
    await Promise.all(resolved.map(async (item) => {
      await withAccount(ctx, item.account, async (client) => {
        for await (const event of client.watchBot({ botId: item.bot.id, sessionId: flags.session ?? "", signal: abort.signal })) {
          if (ctx.json) await writeLine(`${JSON.stringify(redact({ ok: true, account: item.account, botId: item.bot.id, event: publicEvent(event) }))}
`);
          else await writeLine(`${item.account}	${item.bot.id}	${formatEvent(event)}
`);
        }
      });
    }));
    await writeChain;
    return 0;
  } catch (error) {
    abort.abort();
    throw error;
  } finally {
    unregister();
    process.off("SIGINT", onSigint);
    abort.abort();
  }
}
async function commandFiles(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentFiles({
      botId: resolved.bot.id,
      ...flags.pageToken != null ? { pageToken: flags.pageToken } : {}
    });
    const lines = result.files.map((file) => `${file.path}	${file.sizeBytes}	${file.contentType}`).join("\n");
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      count: result.files.length,
      nextPageToken: result.nextPageToken,
      totalBytes: result.totalBytes,
      canEdit: result.canEdit,
      files: result.files
    }, lines || "(no files)");
  });
}
async function commandInvites(ctx, flags) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const result = await client.listAgentAccessInvites(resolved.bot.id);
    const lines = result.invites.map((invite) => invite.email).join("\n");
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      count: result.invites.length,
      invites: result.invites,
      capUsage: result.capUsage
    }, lines || "(no invites)");
  });
}
async function commandBotCreate(ctx, flags) {
  return withAccount(ctx, ctx.account, async (client) => {
    const created = await client.createBot({
      name: flags.name,
      ...flags.description != null ? { description: flags.description } : {},
      ...flags.title != null ? { title: flags.title } : {}
    });
    return ok(ctx, {
      account: ctx.account,
      bot: managedBot(created.bot),
      harness: created.harness
    }, `created ${created.bot.name} (${created.bot.id})`);
  });
}
async function commandBotUpdate(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  const serverId = requireServerId(resolved.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const updated = await client.updateBot({
      id: serverId,
      ...flags.name != null ? { name: flags.name } : {},
      ...flags.description != null ? { description: flags.description } : {},
      ...flags.title != null ? { title: flags.title } : {}
    });
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      serverId,
      bot: managedBot(updated.bot)
    }, `updated ${updated.bot.name} (${updated.bot.id})`);
  });
}
async function commandBotDuplicate(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot);
  return withAccount(ctx, resolved.account, async (client) => {
    const copied = await client.duplicateBot({ botId: resolved.bot.id });
    let bot = copied.bot;
    let renamed = false;
    if (flags.name != null) {
      if (typeof bot.serverId !== "string" || !bot.serverId) {
        throw new CliError("USAGE", `The bot was copied (${bot.id}), but it has no server id, so it was not renamed.`, 3, {
          duplicated: true,
          botId: bot.id,
          account: resolved.account
        });
      }
      try {
        const updated = await client.updateBot({ id: bot.serverId, name: flags.name });
        bot = updated.bot;
        renamed = true;
      } catch (error) {
        const normalized = asCliError(error);
        throw new CliError(normalized.code, `The bot was copied (${copied.bot.id}), but renaming it failed. ${normalized.message}`, normalized.exitCode ?? 4, {
          ...normalized.extra,
          duplicated: true,
          botId: copied.bot.id,
          serverId: copied.bot.serverId,
          account: resolved.account
        });
      }
    }
    return ok(ctx, {
      account: resolved.account,
      sourceBotId: resolved.bot.id,
      renamed,
      bot: managedBot(bot)
    }, `copied ${bot.name} (${bot.id})`);
  });
}
async function commandBotDelete(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot, { exact: true });
  const fields = {
    account: resolved.account,
    botId: resolved.bot.id,
    botName: resolved.bot.name,
    kind: resolved.bot.kind ?? ""
  };
  if (!flags.yes) return dryRun(ctx, "bot delete", fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.deleteBot(resolved.bot.id);
    return ok(ctx, { ...fields, id: result.id, deleted: true }, `deleted ${fields.botName} (${result.id})`);
  });
}
async function commandBot(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === "create") return commandBotCreate(ctx, flags);
  if (sub === "update") return commandBotUpdate(ctx, flags);
  if (sub === "duplicate") return commandBotDuplicate(ctx, flags);
  if (sub === "delete") return commandBotDelete(ctx, flags);
  throw new CliError("USAGE", `Unknown bot command "${sub ?? ""}".`, 3);
}
async function commandRoomCreate(ctx, flags) {
  const scoped = ctx.accountExplicit ? ctx.account : null;
  const members = await resolveMembers(ctx, flags.members, { account: scoped });
  const account = scoped || members[0].account;
  return withAccount(ctx, account, async (client) => {
    const created = await client.createRoom({
      name: flags.name,
      memberAgentIds: members.map((member) => member.bot.id),
      ...flags.description != null ? { description: flags.description } : {}
    });
    return ok(ctx, {
      account,
      bot: managedBot(created.bot),
      members: members.map((member) => ({ account: member.account, id: member.bot.id, name: member.bot.name }))
    }, `created room ${created.bot.name} (${created.bot.id})`);
  });
}
async function commandRoomAddMember(ctx, flags) {
  return withBot(ctx, flags.room, async (client, _session, resolved) => {
    const result = await client.addRoomMembers({ roomId: resolved.bot.id, userIds: flags.userIds });
    return ok(ctx, {
      account: resolved.account,
      roomId: resolved.bot.id,
      userIds: flags.userIds,
      bot: managedBot(result.bot)
    }, `added ${flags.userIds.join(",")} to ${resolved.bot.name}`);
  }, { requireRoom: true });
}
async function commandRoomDelete(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? ""
  };
  if (!flags.yes) return dryRun(ctx, "room delete", fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.deleteRoom(resolved.bot.id);
    return ok(ctx, { ...fields, id: result.id, deleted: true }, `deleted room ${fields.roomName} (${result.id})`);
  });
}
async function commandRoomRemoveMember(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? "",
    userIds: flags.userIds
  };
  if (!flags.yes) return dryRun(ctx, "room remove-member", fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.removeRoomMembers({ roomId: resolved.bot.id, userIds: flags.userIds });
    return ok(ctx, {
      ...fields,
      removed: true,
      bot: result.bot ? managedBot(result.bot) : null
    }, `removed members from ${fields.roomName}`);
  });
}
async function commandRoomSetMembers(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.room, { exact: true, requireRoom: true });
  const members = await resolveMembers(ctx, flags.members, { exact: true, account: resolved.account });
  const fields = {
    account: resolved.account,
    roomId: resolved.bot.id,
    roomName: resolved.bot.name,
    kind: resolved.bot.kind ?? "",
    members: members.map((member) => ({ id: member.bot.id, name: member.bot.name }))
  };
  if (!flags.yes) return dryRun(ctx, "room set-members", fields);
  return withAccount(ctx, resolved.account, async (client) => {
    const result = await client.setRoomMembers({
      roomId: resolved.bot.id,
      memberAgentIds: members.map((member) => member.bot.id)
    });
    return ok(ctx, { ...fields, bot: managedBot(result.bot) }, `set members on ${fields.roomName}`);
  });
}
async function commandRoom(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === "create") return commandRoomCreate(ctx, flags);
  if (sub === "add-member") return commandRoomAddMember(ctx, flags);
  if (sub === "delete") return commandRoomDelete(ctx, flags);
  if (sub === "remove-member") return commandRoomRemoveMember(ctx, flags);
  if (sub === "set-members") return commandRoomSetMembers(ctx, flags);
  throw new CliError("USAGE", `Unknown room command "${sub ?? ""}".`, 3);
}
async function commandSkillWrite(ctx, flags, mode) {
  return withBot(ctx, flags.bot, async (client, _session, resolved) => {
    const content = await readSkillContent(flags);
    const input = {
      botId: resolved.bot.id,
      name: flags.name,
      content,
      ...flags.description != null ? { description: flags.description } : {}
    };
    const result = mode === "add" ? await client.addAgentSkill(input) : await client.updateAgentSkill(input);
    return ok(ctx, {
      account: resolved.account,
      botId: resolved.bot.id,
      name: flags.name,
      skill: publicSkill(result.skill)
    }, `${mode === "add" ? "added" : "updated"} skill ${flags.name}`);
  });
}
async function commandSkillRemove(ctx, flags) {
  const resolved = await resolveBot(ctx, flags.bot, { exact: true });
  const fields = {
    account: resolved.account,
    botId: resolved.bot.id,
    botName: resolved.bot.name,
    kind: resolved.bot.kind ?? "",
    name: flags.name
  };
  if (!flags.yes) return dryRun(ctx, "skill remove", fields);
  return withAccount(ctx, resolved.account, async (client) => {
    await client.removeAgentSkill({ botId: resolved.bot.id, name: flags.name });
    return ok(ctx, { ...fields, removed: true }, `removed skill ${flags.name}`);
  });
}
async function commandSkill(ctx, flags) {
  const sub = flags.args?.[0];
  if (sub === "add") return commandSkillWrite(ctx, flags, "add");
  if (sub === "update") return commandSkillWrite(ctx, flags, "update");
  if (sub === "remove") return commandSkillRemove(ctx, flags);
  throw new CliError("USAGE", `Unknown skill command "${sub ?? ""}".`, 3);
}
function printHelp(ctx) {
  if (ctx.json) writeJson(ctx, { ok: true, help: HELP });
  else ctx.stdout.write(HELP.endsWith("\n") ? HELP : `${HELP}
`);
  return 0;
}
function printVersion(ctx) {
  const runtime = ctx.runtime;
  return ok(ctx, {
    version: CLI_VERSION,
    targetVersion: TARGET_VERSION,
    runtime: runtime.name,
    runtimeVersion: formatRuntimeVersion(runtime.version)
  }, `grok-bot ${CLI_VERSION}
grok-bot-target ${TARGET_VERSION}
${formatRuntimeLine(runtime)}`);
}
async function dispatch(ctx, flags) {
  switch (flags.command) {
    case "login":
      return commandLogin(ctx, flags);
    case "logout":
      return commandLogout(ctx);
    case "status":
      return commandStatus(ctx, flags);
    case "accounts":
      return commandAccounts(ctx, flags);
    case "bots":
      return commandBots(ctx, flags);
    case "sessions":
      return commandSessions(ctx, flags);
    case "transcript":
      return commandTranscript(ctx, flags);
    case "tasks":
      return commandTasks(ctx, flags);
    case "todos":
      return commandTodos(ctx, flags);
    case "skills":
      return commandSkills(ctx, flags);
    case "capabilities":
      return commandCapabilities(ctx);
    case "box":
      return commandBox(ctx);
    case "send":
      return commandSend(ctx, flags);
    case "wait":
      return commandWait(ctx, flags);
    case "relay":
      return commandRelay(ctx, flags);
    case "watch":
      return commandWatch(ctx, flags);
    case "files":
      return commandFiles(ctx, flags);
    case "invites":
      return commandInvites(ctx, flags);
    case "bot":
      return commandBot(ctx, flags);
    case "room":
      return commandRoom(ctx, flags);
    case "skill":
      return commandSkill(ctx, flags);
    default:
      throw new CliError("USAGE", `Unknown command "${flags.command}". Run: grok-bot --help`, 3);
  }
}
async function runCli(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const parsed = parseArgs(options.argv ?? []);
  const directory = configDir({
    platform: options.platform ?? process.platform,
    env,
    homedir: options.homedir ?? homedir()
  });
  const ctx = {
    stdout,
    stderr,
    env,
    json: parsed.json,
    profile: parsed.profile || parsed.account || "default",
    account: parsed.profile || parsed.account || "default",
    accountExplicit: Boolean(parsed.profile || parsed.account),
    noOpen: parsed.noOpen,
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    now: options.now ?? Date.now,
    sleep: options.sleep ?? delay2,
    openBrowser: options.openBrowser ?? ((url) => defaultOpen(url, options.platform ?? process.platform)),
    configDirectory: directory,
    credentialFile: credentialPath(directory, parsed.profile || parsed.account || "default"),
    pendingFile: pendingPath(directory, parsed.profile || parsed.account || "default"),
    runtime: options.runtime ?? detectRuntime()
  };
  try {
    const runtimeMessage = unsupportedRuntime(ctx.runtime);
    if (runtimeMessage) return fail(ctx, new CliError("RUNTIME_UNSUPPORTED", runtimeMessage, 3));
    if (!parsed.ok) return fail(ctx, new CliError("USAGE", parsed.errors[0], 3));
    if (parsed.help || parsed.command === "help") return printHelp(ctx);
    if (parsed.version || parsed.command === "version") return printVersion(ctx);
    if (!parsed.command) return fail(ctx, new CliError("USAGE", "Missing command. Run: grok-bot --help", 3));
    if (!COMMAND_NAMES.has(parsed.command)) return fail(ctx, new CliError("USAGE", `Unknown command "${parsed.command}". Run: grok-bot --help`, 3));
    const commandErrors = validateCommand(parsed);
    if (commandErrors.length) return fail(ctx, new CliError("USAGE", commandErrors[0], 3));
    const registry = await registryOf(ctx);
    if (!ctx.accountExplicit) bindAccount(ctx, registry.default || "default");
    else bindAccount(ctx, parsed.account || parsed.profile);
    ctx.accountExplicit = Boolean(parsed.account || parsed.profile);
    return await dispatch(ctx, parsed);
  } catch (error) {
    return fail(ctx, normalizeError(error));
  }
}

// src/main.mjs
try {
  const code = await runCli({ argv: programArgs(process.argv) });
  await finishProcess(code);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    process.stderr.write(`${message}
`);
  } catch {
  }
  await finishProcess(4);
}
