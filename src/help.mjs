import { CLI_VERSION, DEFAULT_IDLE_SEC, DEFAULT_TIMEOUT_SEC, LOGIN_WAIT_SEC, MAX_RELAY_ROUNDS, MAX_TIMEOUT_SEC, START_TTL_SEC, TARGET_VERSION } from './constants.mjs';

export const HELP = `grok-bot ${CLI_VERSION} (Grok Bot protocol ${TARGET_VERSION})

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
