import { MAX_TIMEOUT_SEC } from './constants.mjs';

function baseName(value) {
  const text = String(value ?? '');
  const cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return cut === -1 ? text : text.slice(cut + 1);
}

export function programArgs(argv = process.argv) {
  let args = argv.slice(1);
  const first = args[0];
  if (!first || first.startsWith('-')) return args;
  // node/bun <script> …, an npm bin path with no extension, a duplicated argv[0],
  // or Bun's compiled /$bunfs/root/<exe> entry.
  const runtime = /^(?:node|nodejs|bun)(?:\.exe)?$/i.test(baseName(argv[0]));
  const script = runtime && (/\.(?:mjs|cjs|js)$/.test(first) || first.includes('/') || first.includes('\\'));
  if (first === argv[0] || first.includes('$bunfs/') || script) args = args.slice(1);
  return args;
}

const BOOLEANS = new Set(['json', 'help', 'version', 'start', 'wait', 'no-open', 'check', 'all-accounts', 'dry-run', 'yes']);
const VALUES = new Set(['profile', 'account', 'timeout', 'idle-timeout', 'bot', 'text', 'session', 'limit', 'file', 'from', 'to', 'template', 'rounds', 'message-id', 'page-token', 'name', 'description', 'title', 'member', 'room', 'user-id', 'content', 'content-file']);
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ACCOUNT_COMMANDS = new Set(['list', 'add', 'use', 'rename', 'remove']);

function takeValue(argv, index, name, inline) {
  if (inline !== undefined) return { value: inline, index };
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) return { error: `--${name} needs a value` };
  return { value: next, index: index + 1 };
}

function parseNumber(value, name, { integer = false, allowZero = false } = {}) {
  if (value === '' || value == null) return { error: `--${name} needs a number` };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) return { error: `--${name} must be a ${allowZero ? 'non-negative' : 'positive'} number` };
  if (integer && !Number.isInteger(number)) return { error: `--${name} must be an integer` };
  return { value: number };
}

export function parseArgs(argv) {
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
    errors: [],
  };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '-V') {
      parsed.version = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    if (!BOOLEANS.has(name) && !VALUES.has(name)) {
      parsed.errors.push(`Unknown flag --${name}`);
      continue;
    }
    if (BOOLEANS.has(name)) {
      if (inline !== undefined) parsed.errors.push(`--${name} does not take a value`);
      if (name === 'json') parsed.json = true;
      else if (name === 'help') parsed.help = true;
      else if (name === 'version') parsed.version = true;
      else if (name === 'start') parsed.start = true;
      else if (name === 'wait') parsed.wait = true;
      else if (name === 'no-open') parsed.noOpen = true;
      else if (name === 'check') parsed.check = true;
      else if (name === 'all-accounts') parsed.allAccounts = true;
      else if (name === 'dry-run') parsed.dryRun = true;
      else if (name === 'yes') parsed.yes = true;
      continue;
    }
    const taken = takeValue(argv, index, name, inline);
    if (taken.error) {
      parsed.errors.push(taken.error);
      continue;
    }
    index = taken.index;
    if (name === 'file') {
      parsed.file.push(taken.value);
      continue;
    }
    if (name === 'member') {
      parsed.members.push(taken.value);
      continue;
    }
    if (name === 'user-id') {
      const number = parseNumber(taken.value, 'user-id', { integer: true });
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > 2147483647) parsed.errors.push('--user-id must be an integer from 1 to 2147483647');
      else parsed.userIds.push(number.value);
      continue;
    }
    if (name === 'profile' || name === 'account') {
      if (!PROFILE.test(taken.value)) parsed.errors.push(`--${name} must be 1-64 letters, digits, "_" or "-"`);
      else if (name === 'profile') parsed.profile = taken.value;
      else parsed.account = taken.value;
      continue;
    }
    if (name === 'timeout') {
      const number = parseNumber(taken.value, 'timeout');
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > MAX_TIMEOUT_SEC) parsed.errors.push(`--timeout must be from 1 to ${MAX_TIMEOUT_SEC} seconds`);
      else parsed.timeout = number.value;
      continue;
    }
    if (name === 'idle-timeout') {
      const number = parseNumber(taken.value, 'idle-timeout', { allowZero: true });
      if (number.error) parsed.errors.push(number.error);
      else parsed.idleTimeout = number.value;
      continue;
    }
    if (name === 'limit') {
      const number = parseNumber(taken.value, 'limit', { integer: true });
      if (number.error) parsed.errors.push(number.error);
      else if (number.value > 500) parsed.errors.push('--limit must be from 1 to 500');
      else parsed.limit = number.value;
      continue;
    }
    if (name === 'bot') {
      parsed.bots.push(taken.value);
      parsed.bot = parsed.bots[0];
    } else if (name === 'text') parsed.text = taken.value;
    else if (name === 'session') parsed.session = taken.value;
    else if (name === 'from') parsed.from = taken.value;
    else if (name === 'to') parsed.to = taken.value;
    else if (name === 'template') parsed.template = taken.value;
    else if (name === 'message-id') parsed.messageId = taken.value;
    else if (name === 'rounds') {
      const number = parseNumber(taken.value, 'rounds', { integer: true, allowZero: true });
      if (number.error) parsed.errors.push(number.error);
      else parsed.rounds = number.value;
    } else if (name === 'page-token') parsed.pageToken = taken.value;
    else if (name === 'name') parsed.name = taken.value;
    else if (name === 'description') parsed.description = taken.value;
    else if (name === 'title') parsed.title = taken.value;
    else if (name === 'room') {
      if (parsed.room != null) parsed.errors.push('--room can be set only once');
      parsed.room = taken.value;
    } else if (name === 'content') parsed.content = taken.value;
    else if (name === 'content-file') parsed.contentFile = taken.value;
  }
  parsed.command = positionals[0] ?? null;
  parsed.args = positionals.slice(1);
  if (parsed.command === 'bot' || parsed.command === 'room' || parsed.command === 'skill') {
    if (positionals.length > 2) parsed.errors.push(`Unexpected argument "${positionals[2]}"`);
  } else if (parsed.command !== 'accounts' && positionals.length > 1) parsed.errors.push(`Unexpected argument "${positionals[1]}"`);
  if (parsed.command === 'help') parsed.help = true;
  if (parsed.command === 'version') parsed.version = true;
  parsed.ok = parsed.errors.length === 0;
  return parsed;
}

const COMMANDS = {
  login: ['start', 'wait', 'no-open', 'timeout'],
  logout: [],
  status: ['all-accounts'],
  bots: ['all-accounts'],
  sessions: ['bot'],
  transcript: ['bot', 'session', 'limit'],
  tasks: ['bot', 'session'],
  todos: ['bot'],
  skills: ['bot'],
  capabilities: [],
  box: [],
  send: ['bot', 'text', 'session', 'file', 'wait', 'timeout', 'idle-timeout'],
  watch: ['bot', 'session'],
  wait: ['bot', 'message-id', 'session', 'timeout', 'idle-timeout'],
  relay: ['from', 'to', 'text', 'template', 'rounds', 'timeout', 'idle-timeout', 'dry-run'],
  accounts: ['check', 'start', 'wait', 'no-open', 'timeout'],
  files: ['bot', 'page-token'],
  invites: ['bot'],
};

const BOT_COMMANDS = new Set(['create', 'update', 'duplicate', 'delete']);
const ROOM_COMMANDS = new Set(['create', 'add-member', 'delete', 'remove-member', 'set-members']);
const SKILL_COMMANDS = new Set(['add', 'update', 'remove']);

const BOT_FLAGS = {
  create: ['name', 'description', 'title'],
  update: ['bot', 'name', 'description', 'title'],
  duplicate: ['bot', 'name'],
  delete: ['bot', 'yes'],
};
const ROOM_FLAGS = {
  create: ['name', 'description', 'member'],
  'add-member': ['room', 'user-id'],
  delete: ['room', 'yes'],
  'remove-member': ['room', 'user-id', 'yes'],
  'set-members': ['room', 'member', 'yes'],
};
const SKILL_FLAGS = {
  add: ['bot', 'name', 'content', 'content-file', 'description'],
  update: ['bot', 'name', 'content', 'content-file', 'description'],
  remove: ['bot', 'name', 'yes'],
};

const ACCOUNT_FLAGS = {
  list: ['check'],
  add: ['start', 'wait', 'no-open', 'timeout'],
  use: [],
  rename: [],
  remove: [],
};

export const COMMAND_NAMES = new Set([...Object.keys(COMMANDS), 'bot', 'room', 'skill']);

function usedFlags(parsed) {
  const used = [];
  if (parsed.start) used.push('start');
  if (parsed.wait) used.push('wait');
  if (parsed.noOpen) used.push('no-open');
  if (parsed.timeout != null) used.push('timeout');
  if (parsed.idleTimeout != null) used.push('idle-timeout');
  if (parsed.bot != null) used.push('bot');
  if (parsed.text != null) used.push('text');
  if (parsed.session != null) used.push('session');
  if (parsed.limit != null) used.push('limit');
  if (parsed.file.length) used.push('file');
  if (parsed.check) used.push('check');
  if (parsed.allAccounts) used.push('all-accounts');
  if (parsed.dryRun) used.push('dry-run');
  if (parsed.from != null) used.push('from');
  if (parsed.to != null) used.push('to');
  if (parsed.template != null) used.push('template');
  if (parsed.rounds != null) used.push('rounds');
  if (parsed.messageId != null) used.push('message-id');
  if (parsed.yes) used.push('yes');
  if (parsed.pageToken != null) used.push('page-token');
  if (parsed.name != null) used.push('name');
  if (parsed.description != null) used.push('description');
  if (parsed.title != null) used.push('title');
  if (parsed.members.length) used.push('member');
  if (parsed.room != null) used.push('room');
  if (parsed.userIds.length) used.push('user-id');
  if (parsed.content != null) used.push('content');
  if (parsed.contentFile != null) used.push('content-file');
  return used;
}

function validateAlias(value, label) {
  if (!PROFILE.test(value)) return `${label} must be 1-64 letters, digits, "_" or "-"`;
  return '';
}

function validateAccounts(parsed) {
  const [sub, ...rest] = parsed.args ?? [];
  if (!sub || !ACCOUNT_COMMANDS.has(sub)) {
    return [sub ? `Unknown accounts command "${sub}"` : 'accounts requires list, add, use, rename, or remove'];
  }
  const errors = [];
  for (const flag of usedFlags(parsed)) {
    if (!ACCOUNT_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for accounts ${sub}`);
  }
  if (sub === 'list' && rest.length) errors.push(`Unexpected argument "${rest[0]}"`);
  if (sub === 'add') {
    if (rest.length !== 1) errors.push('accounts add requires <alias>');
    else {
      const aliasError = validateAlias(rest[0], 'Account alias');
      if (aliasError) errors.push(aliasError);
    }
    if (parsed.start && parsed.wait) errors.push('--start and --wait cannot be combined');
  }
  if (sub === 'use' || sub === 'remove') {
    if (rest.length !== 1) errors.push(`accounts ${sub} requires <alias>`);
    else {
      const aliasError = validateAlias(rest[0], 'Account alias');
      if (aliasError) errors.push(aliasError);
    }
  }
  if (sub === 'rename') {
    if (rest.length !== 2) errors.push('accounts rename requires <old> <new>');
    else {
      const oldError = validateAlias(rest[0], 'Account alias');
      const newError = validateAlias(rest[1], 'Account alias');
      if (oldError || newError) errors.push(oldError || newError);
      else if (rest[0] === rest[1]) errors.push('accounts rename needs two different aliases');
    }
  }
  return errors;
}

function requireText(value, flag) {
  if (value == null) return '';
  if (!String(value).trim()) return `--${flag} must not be empty`;
  return '';
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
    return [sub ? `Unknown bot command "${sub}"` : 'bot requires create, update, duplicate, or delete'];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push('--bot can be repeated only for watch');
  for (const flag of usedFlags(parsed)) {
    if (!BOT_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for bot ${sub}`);
  }
  const nameError = requireText(parsed.name, 'name');
  if (sub === 'create') {
    if (parsed.name == null) errors.push('bot create requires --name <name>');
    else if (nameError) errors.push(nameError);
  }
  if (sub === 'update') {
    if (!parsed.bot) errors.push('bot update requires --bot <id|name>');
    if (parsed.name == null && parsed.description == null && parsed.title == null) {
      errors.push('bot update requires --name, --description, or --title');
    }
    if (nameError) errors.push(nameError);
  }
  if (sub === 'duplicate') {
    if (!parsed.bot) errors.push('bot duplicate requires --bot <id|name>');
    if (nameError) errors.push(nameError);
  }
  if (sub === 'delete' && !parsed.bot) errors.push('bot delete requires --bot <id|name>');
  return errors;
}

function validateRoom(parsed) {
  const [sub] = parsed.args ?? [];
  if (!sub || !ROOM_COMMANDS.has(sub)) {
    return [sub ? `Unknown room command "${sub}"` : 'room requires create, add-member, delete, remove-member, or set-members'];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push('--bot can be repeated only for watch');
  for (const flag of usedFlags(parsed)) {
    if (!ROOM_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for room ${sub}`);
  }
  const nameError = requireText(parsed.name, 'name');
  if (sub === 'create') {
    if (parsed.name == null) errors.push('room create requires --name <name>');
    else if (nameError) errors.push(nameError);
    if (!parsed.members.length) errors.push('room create requires --member <bot>');
  }
  if (sub === 'add-member' || sub === 'remove-member') {
    if (!parsed.room) errors.push(`room ${sub} requires --room <id|name>`);
    if (!parsed.userIds.length) errors.push(`room ${sub} requires --user-id <id>`);
  }
  if (sub === 'delete' && !parsed.room) errors.push('room delete requires --room <id|name>');
  if (sub === 'set-members') {
    if (!parsed.room) errors.push('room set-members requires --room <id|name>');
    if (!parsed.members.length) errors.push('room set-members requires --member <bot>');
  }
  return errors;
}

function validateSkill(parsed) {
  const [sub] = parsed.args ?? [];
  if (!sub || !SKILL_COMMANDS.has(sub)) {
    return [sub ? `Unknown skill command "${sub}"` : 'skill requires add, update, or remove'];
  }
  const errors = [];
  if (parsed.bots.length > 1) errors.push('--bot can be repeated only for watch');
  for (const flag of usedFlags(parsed)) {
    if (!SKILL_FLAGS[sub].includes(flag)) errors.push(`--${flag} is not valid for skill ${sub}`);
  }
  const nameError = requireText(parsed.name, 'name');
  if (sub === 'add' || sub === 'update') {
    if (!parsed.bot) errors.push(`skill ${sub} requires --bot <id|name>`);
    if (parsed.name == null) errors.push(`skill ${sub} requires --name <name>`);
    else if (nameError) errors.push(nameError);
    errors.push(...requireContent(parsed, `skill ${sub}`));
  }
  if (sub === 'remove') {
    if (!parsed.bot) errors.push('skill remove requires --bot <id|name>');
    if (parsed.name == null) errors.push('skill remove requires --name <name>');
    else if (nameError) errors.push(nameError);
  }
  return errors;
}

export function validateCommand(parsed) {
  if (!parsed.command || parsed.command === 'help' || parsed.command === 'version') return [];
  if (parsed.account && parsed.profile && parsed.account !== parsed.profile) {
    return ['--account and --profile must name the same account'];
  }
  if (parsed.command === 'accounts') return validateAccounts(parsed);
  if (parsed.command === 'bot') return validateBot(parsed);
  if (parsed.command === 'room') return validateRoom(parsed);
  if (parsed.command === 'skill') return validateSkill(parsed);
  const allowed = COMMANDS[parsed.command];
  if (!allowed) return [`Unknown command "${parsed.command}"`];
  const errors = [];
  for (const flag of usedFlags(parsed)) {
    if (!allowed.includes(flag)) errors.push(`--${flag} is not valid for ${parsed.command}`);
  }
  if ((parsed.command === 'login') && parsed.start && parsed.wait) errors.push('--start and --wait cannot be combined');
  if ((parsed.command === 'send' || parsed.command === 'relay') && parsed.text != null && !parsed.text.trim()) errors.push('--text must not be empty');
  if (parsed.command === 'send' && (parsed.timeout != null || parsed.idleTimeout != null) && !parsed.wait) {
    errors.push('--timeout and --idle-timeout require send --wait');
  }
  if (parsed.bots.length > 1 && parsed.command !== 'watch') errors.push('--bot can be repeated only for watch');
  const needsBot = allowed.includes('bot');
  if (needsBot && !parsed.bot) errors.push(`${parsed.command} requires --bot <id|name>`);
  if (parsed.command === 'send' && parsed.text == null) errors.push('send requires --text <text>');
  if (parsed.command === 'wait' && !parsed.messageId) errors.push('wait requires --message-id <id>');
  if (parsed.command === 'relay') {
    if (!parsed.from) errors.push('relay requires --from <bot>');
    if (!parsed.to) errors.push('relay requires --to <bot>');
    if (parsed.text == null) errors.push('relay requires --text <text>');
    if (parsed.rounds != null && (parsed.rounds < 1 || parsed.rounds > 10)) errors.push('--rounds must be an integer from 1 to 10');
  }
  return errors;
}
