# grok-bot commands

CLI 0.78.1, Grok Bot protocol 0.78.1. Command lines and the exit-code list match `node dist/grok-bot.mjs --help` (same text as `skills/grok-bot/scripts/grok-bot --help`). Node and Bun print the same help. Run commands through the skill launcher, `scripts/grok-bot` (Windows: `scripts/grok-bot.cmd`). The launcher is not a second CLI. It only selects a runtime, checks `bin/SHA256SUMS`, and execs `bin/grok-bot.mjs`.

An account is an alias. `--account <alias>` and `--profile <name>` are the same flag. Agent decisions are in `SKILL.md`. This file is the flag and JSON reference.

`JSON.stringify` drops keys whose value is `undefined`. `null` is kept. Every `--json` failure includes `error.exitCode`, equal to the process exit code. `send` and `relay` failures also include `error.sent`. A failed `relay` also includes `error.completedSteps`.

Shapes below come from `src/cli.mjs`, `test/accounts.test.mjs`, and `test/manage.test.mjs`. Read-only commands were also checked with the launcher (`--help`, `--version`, `accounts list`, `status`, `status --all-accounts`, `bots`, `bots --all-accounts`, `transcript --limit 1`, `relay --dry-run`). Those runs did not send a message and did not start a login. `send`, `wait`, and a real `relay` were not run against an account. Their keys are from the source and the mocked tests. Management writes are covered by mocked tests. `files`, `invites`, and `bot delete` without `--yes` do not write.

## Global flags

```text
grok-bot [--json] [--account <alias>] <command> [flags]
```

Flags may come before or after the command. A value flag accepts `--flag value` and `--flag=value`. Boolean flags do not take a value.

| Flag | Effect |
| --- | --- |
| `--json` | One JSON object on stdout. `watch` is the exception: one object per line. Logs stay on stderr. |
| `--account <alias>` | Account to use. `--profile <name>` is the same flag. When both are set they must match, or the command exits 3 with `USAGE` and message `--account and --profile must name the same account`. When neither is set, the CLI uses `accounts.json` `default`, or the alias `default` when the registry has no default. |
| `--help`, `-h` | Print help and exit 0. Also `grok-bot help`. Ignores the named command. |
| `--version`, `-V` | Print the version and exit 0. Also `grok-bot version`. Ignores the named command. |

An alias is 1–64 characters of `[A-Za-z0-9_-]`, and it must start with a letter or digit. A bad `--account` or `--profile` exits 3: `--account must be 1-64 letters, digits, "_" or "-"`.

Human `--version` stdout is three lines. The runtime check in the next section runs first, so an unsupported runtime never prints this:

```text
grok-bot 0.78.1
grok-bot-target 0.78.1
runtime node v22.20.0
```

On Bun the third line is `runtime bun vX.Y.Z`. A newer CLI may change the first line. `0.78.1` is the protocol this tree targets.

`--version --json`:

```json
{"ok":true,"version":"0.78.1","targetVersion":"0.78.1","runtime":"node","runtimeVersion":"v22.20.0"}
```

`runtimeVersion` always has a leading `v`. `grok-bot status --version` prints the version and does not check login. It still loses to the runtime check.

### RUNTIME_UNSUPPORTED

Exit 3. This runs before argument parsing's success path and before `--version`. Without `--json`, stdout is empty and stderr is one line, `RUNTIME_UNSUPPORTED: <message>`. With `--json`, Node.js below 22.13 looks like this (`22.12.9` is the injected test version; the live message uses the version it saw):

```json
{"ok":false,"error":{"code":"RUNTIME_UNSUPPORTED","message":"Node.js v22.12.9 is too old. Install Node.js 22 LTS (22.13 or newer) or Bun.","exitCode":3}}
```

The current error writer always adds `exitCode`. Older notes that omit it are stale.

Node.js 22.13.0 is allowed. Bun below 1.1, and any runtime that is not Node or Bun, uses the other message: `This runtime is not supported (<name> v<version>). Install Node.js 22 LTS (22.13 or newer) or Bun 1.1 or newer.` Bun 1.1.0 is allowed. Bun sets both `process.versions.bun` and `process.versions.node`. The CLI reads Bun first.

These two old-runtime bodies are from `src/runtime.mjs` and the injected versions in `test/cli.test.mjs`. They were not produced by replacing the Node or Bun binary. `exitCode` is added by `src/cli.mjs` for every `--json` error.

### Launcher codes

These two codes are printed by `scripts/grok-bot` (and the Windows `grok-bot.ps1`) before `grok-bot.mjs` starts. They are not in the CLI help text. Exit code is 3. Without `--json`, stdout is empty and stderr is `CODE: message`. With `--json`, stdout is one object and the same text is also on stderr. The launcher object does not add `exitCode`. Install progress, when it happens, is only on stderr.

| Code | When |
| --- | --- |
| `RUNTIME_INSTALL_FAILED` | Node.js 22.13+ and Bun are both missing, and Bun was not installed. Also when `GROK_BOT_NO_AUTO_INSTALL=1`, when `GROK_BOT_RUNTIME` is not `node` or `bun`, or when `GROK_BOT_RUNTIME=node` but `node` is not on `PATH`. stderr lists the manual install commands. |
| `CLI_CHECKSUM_MISMATCH` | `bin/grok-bot.mjs` does not match `bin/SHA256SUMS`, or either file is missing. |

`RUNTIME_INSTALL_FAILED` with `--json`:

```json
{"ok":false,"error":{"code":"RUNTIME_INSTALL_FAILED","message":"Automatic install is off (GROK_BOT_NO_AUTO_INSTALL=1). Install Node.js 22.13 or newer, or Bun 1.1 or newer. See stderr for commands."}}
```

The `message` text changes with the cause. The code and the exit code do not. A checksum failure:

```json
{"ok":false,"error":{"code":"CLI_CHECKSUM_MISMATCH","message":"grok-bot.mjs does not match SHA256SUMS."}}
```

The launcher hashes the file on every start when `shasum`, `sha256sum`, or `certutil` is on `PATH` (Windows PowerShell uses `Get-FileHash`, then `certutil`). If none of those tools exist, it skips the check. It writes the skip notice to stderr only when the arguments include `--version`, `-V`, or `version`.

Runtime choice, first match wins:

1. `GROK_BOT_RUNTIME=node` uses `node` on `PATH` even when it is older than 22.13. The CLI then returns `RUNTIME_UNSUPPORTED`. A missing `node` is `RUNTIME_INSTALL_FAILED` and does not install Bun.
2. `GROK_BOT_RUNTIME=bun` uses `bun` on `PATH`, then `$BUN_INSTALL/bin/bun` or `%USERPROFILE%\.bun\bin\bun.exe`.
3. With the variable unset: `node` on `PATH` at 22.13 or newer, else `bun` on `PATH`, else the Bun prefix above.
4. Still nothing, and `GROK_BOT_NO_AUTO_INSTALL` is not `1`: install Bun with the official user-directory installer. `BUN_INSTALL` is honored. The next command is the absolute path `$BUN_INSTALL/bin/bun`. macOS and Linux need `unzip` and `bash`. The arguments, the exit code, and Ctrl-C pass through to that process.

`--help --json` is `{"ok":true,"help":"<the full help text>"}`. The help text names `RUNTIME_UNSUPPORTED`, the runtime line, and exit 3 as "bad arguments, or the runtime is not supported". The help string says a command writes one JSON object. `watch --json` does not. It writes NDJSON.

## Exit codes

| Exit | Help text |
| --- | --- |
| 0 | success |
| 2 | not logged in, or the credentials were rejected |
| 3 | bad arguments, or the runtime is not supported |
| 4 | network or server error |
| 5 | timeout |

What the agent should do next is in `SKILL.md`. The code string is `error.code`. On CLI `--json` errors, `error.exitCode` is the same number as the process status.

## Error object

```json
{"ok":false,"error":{"code":"...","message":"...","exitCode":3}}
```

Extra fields are copied onto `error` next to `code` and `message`. `exitCode` is written after those extras. Secret-looking keys are replaced with `"[redacted]"` before printing (`accessToken`, `refreshToken`, `verifier`, `authorization`, `gatewayToken`, `networkToken`, `password`, `secret`, plus the same names with `_` or `-`). Do not read the credential file to recover them.

`send` and `relay` always add `error.sent` when the failure is thrown from those commands. `sent: true` means the SDK accepted that message. The CLI does not send it again. `sent: false` means it was not accepted. Usage errors rejected before the command runs, such as a missing `--text`, do not add `sent`.

A `relay` failure thrown from the command also adds `error.completedSteps`, the steps that finished before the failing step. Each of those steps has `sent: true`. Do not repeat them. `error.sent` describes only the step that failed. When that step was accepted, `error.messageId` is present and `wait` can continue it. `wait` itself does not send. A `wait` failure inside the wait loop carries `sent: false`.

### Codes

| Code | Exit | When | Extra |
| --- | --- | --- | --- |
| `NOT_LOGGED_IN` | 2 | No credential, or the token was rejected | Logged-out form adds `profile` and `credentialPath`. Rejected form has neither. Message is `Not logged in. Run: grok-bot login` or `Credentials were rejected. Run: grok-bot login`. |
| `CREDENTIALS_INVALID` | 2 | Credential file is not valid JSON, or it has no access token | none |
| `AUTH_REVOKED` | 2 | The session was revoked | none |
| `AUTH_REFRESH_FAILED` | 2 | Refresh failed | none |
| `LOGIN_EXPIRED` | 2 | Pending login is past `expiresAt` | none |
| `SIGN_IN_POLICY_VIOLATION` | 2 | The organization refused sign-in | none |
| `LOGIN_TIMED_OUT` | 5 | The user did not finish the browser login in time | none |
| `LOGIN_POLL_FAILED` | 4 | The poll failed, or the login response had no credentials | none |
| `LOGIN_NOT_STARTED` | 3 | `--wait` with no pending login | none |
| `ACCOUNT_ALREADY_ADDED` | 3 | `accounts add` / `login` found this person already registered under another alias. The new credential is not saved. The pending file is removed. | `alias` and `account`, both the existing alias. Message: `This account is already added as <alias>.` |
| `ACCOUNT_NOT_FOUND` | 3 | `accounts use`, `rename`, or `remove` named an alias that is not registered and has no credential file | none |
| `ACCOUNT_EXISTS` | 3 | `accounts rename` target already has a registry row, a credential file, or a pending file. Nothing is overwritten. | none |
| `ACCOUNTS_INVALID` | 3 | `accounts.json` is not valid JSON or has an unsupported shape. The file is not overwritten. | none |
| `AMBIGUOUS_BOT` | 3 | More than one bot matched, or a destructive command matched only by a name fragment | `candidates`: `{account, id, name}[]`. Several hits: pass an id or an account prefix. A fragment on `bot delete`, `room delete`, `room remove-member`, `room set-members`, or `skill remove` is refused even when it is the only hit. That message says to pass an id or the full name. |
| `BOT_NOT_FOUND` | 3 | No bot matched | `failedAccounts`: `{account, code}[]` when other logged-in accounts could not be searched and nothing matched. A single explicit target returns that account's own code instead, such as `NOT_LOGGED_IN` or `RPC_FAILED`. |
| `NOT_A_ROOM` | 3 | `--room`, or a room write, resolved a record that is not a room | `account`, `id`, `name`, `kind` when the CLI rejects it before the write. Message: `"<name>" (<id>) is not a room.` The SDK form, if a delete still reaches it, is `That id is not a room.` |
| `FILE_NOT_FOUND` | 3 | An attachment path or `--content-file` is unreadable. Checked only after the bot resolves. | none |
| `USAGE` | 3 | Bad arguments. `error.message` names the flag. | none |
| `TIMEOUT` | 5 | `send --wait`, `wait`, or a `relay` step ran out of time | `text`, `endedBy` (`timeout`), `botId`, `account`. After a real send also `messageId` and `sent: true`. `wait` sets `sent: false` and does not claim a new message was sent. `send --wait` message: `Timed out waiting for the reply. The message was sent. Continue with: grok-bot wait --bot <alias>:<botId> --message-id <id>`. |
| `TURN_FAILED` | 4 | The turn failed after the message was accepted | `text`, `endedBy` (`turn-failed`), `botId`, `account`, `messageId`, `sent: true` |
| `STREAM_CLOSED` | 4 | The event stream closed before a reply | `text`, `endedBy` (`stream-closed`), `botId`, `account`, and `sent` / `messageId` when the send was accepted |
| `STREAM_CONNECTION_FAILED` | 4 | The watch did not connect. This is before `send`. | `sent: false` |
| `WATCH_AFTER_SEND_FAILED` | 4 | The message was accepted, then waiting failed | `sent: true`. `messageId` may be absent. Do not send again. |
| `SEND_REFUSED` | 4 | The server refused the message | `sent: false` when thrown from `send` or `relay` |
| `ACCOUNT_AUTH_FAILED` | 4 | The account request was rejected. An HTTP 500 on `status` produces this code. | none |
| `NETWORK` | 4 | The request failed, or the token endpoint could not be reached | none |
| SDK arg codes `MESSAGE_INVALID`, `BOT_ID_REQUIRED`, `CURSOR_INVALID`, `CURSOR_SCOPE_MISMATCH` | 3 | `<CODE>. Check the command flags.` | none |
| other SDK codes, or `RPC_FAILED` | 4 | `The request failed.` | `sent` when the failure is inside `send` or `relay` |
| HTTP 408 | 5 | `The request timed out.` (`TIMEOUT`) | none |

`accounts list --check` does not fail the process when one account's `check` is not ok. The exit code stays 0. `bots --all-accounts` and `status --all-accounts` stay exit 0 when at least one account succeeds. They exit with the first failure's code only when every registered account fails.

### USAGE messages

All exit 3. The first problem is the one returned.

| Command shape | `error.message` |
| --- | --- |
| `--json` (no command) | `Missing command. Run: grok-bot --help` |
| unknown command | `Unknown command "<name>". Run: grok-bot --help` |
| unknown flag | `Unknown flag --<name>` |
| `--account` and `--profile` differ | `--account and --profile must name the same account` |
| bad alias | `--account must be 1-64 letters, digits, "_" or "-"` (same sentence for `--profile` and for `Account alias`) |
| flag not valid for that command | `--text is not valid for bots` |
| `sessions` / `transcript` / `tasks` / `todos` / `skills` / `watch` / `wait` without `--bot` | `<command> requires --bot <id\|name>` |
| `send` without `--bot` | `send requires --bot <id\|name>` |
| `send` without `--text` | `send requires --text <text>` |
| `send` or `relay` `--text` of only spaces | `--text must not be empty` |
| `--timeout` or `--idle-timeout` on `send` without `--wait` | `--timeout and --idle-timeout require send --wait` |
| `--timeout 0` | `--timeout must be a positive number` |
| `--timeout` above 3600 | `--timeout must be from 1 to 3600 seconds` |
| `--limit` outside 1–500 | `--limit must be a positive number` or `--limit must be from 1 to 500` |
| `login --start --wait`, or the same pair on `accounts add` | `--start and --wait cannot be combined` |
| repeated `--bot` on a command other than `watch` | `--bot can be repeated only for watch` |
| `wait` without `--message-id` | `wait requires --message-id <id>` |
| `relay` missing an end or the text | `relay requires --from <bot>`, `relay requires --to <bot>`, or `relay requires --text <text>` |
| `--rounds` outside 1–10 | `--rounds must be an integer from 1 to 10` |
| `alias:` with an empty name | `Bot reference is missing a name after the account prefix.` |
| `--account A` plus a ref prefixed with another registered alias | `Bot account "<prefix>" does not match --account A.` |
| `accounts` with no subcommand | `accounts requires list, add, use, rename, or remove` |
| unknown accounts subcommand | `Unknown accounts command "<name>"` |
| `accounts add` without an alias | `accounts add requires <alias>` |
| `accounts rename` with one alias, or the same alias twice | `accounts rename requires <old> <new>` or `accounts rename needs two different aliases` |
| `bot` / `room` / `skill` with no subcommand | `bot requires create, update, duplicate, or delete`, `room requires create, add-member, delete, remove-member, or set-members`, or `skill requires add, update, or remove` |
| unknown subcommand | `Unknown bot command "<name>"` (same shape for `room` and `skill`) |
| `files` or `invites` without `--bot` | `<command> requires --bot <id\|name>` |
| `bot create` without `--name`, or an empty `--name` | `bot create requires --name <name>` or `--name must not be empty` |
| `bot update` without a field | `bot update requires --name, --description, or --title` |
| `bot delete` without `--bot` | `bot delete requires --bot <id\|name>` |
| `room create` without `--name` or `--member` | `room create requires --name <name>` or `room create requires --member <bot>` |
| `room add-member` or `room remove-member` missing a flag | `room <sub> requires --room <id\|name>` or `room <sub> requires --user-id <id>` |
| `room set-members` without `--member` | `room set-members requires --member <bot>` |
| `--user-id` 0, a fraction, or above 2147483647 | `--user-id must be a positive number`, `--user-id must be an integer`, or `--user-id must be an integer from 1 to 2147483647` |
| `--room` twice | `--room can be set only once` |
| `skill add` or `skill update` content flags | `skill <sub> requires --content or --content-file`, or `skill <sub> accepts either --content or --content-file` |
| `--yes` on a command that is not destructive, or `--dry-run` on `bot delete` | `--yes is not valid for <command>` or `--dry-run is not valid for bot delete` |
| room members on different accounts | `Room members must use the same account.` The message names both accounts. With `--account`, a member on another account says `Member "<name>" is on account "<other>", not "<account>".` |

Without `--json`, the same failure is stderr `CODE: message` and empty stdout.

## login

```text
login [--start | --wait] [--no-open] [--timeout <seconds>]
```

`--account` selects which alias is logged in. `--timeout` must be a positive number. It is rejected before any login starts.

| Mode | Behavior |
| --- | --- |
| `--start` | Create a pending login and return immediately. Default lifetime 900s. |
| `--wait` | Poll the pending login. Default 300s. |
| neither | Print the URL, open a browser unless `--no-open`, and poll. Agents do not use this. |
| both | Exit 3, `--start and --wait cannot be combined`. |

`--no-open` skips `open` (macOS), `xdg-open` (Linux), and `start` (Windows).

`--start --json` keys: `ok`, `loginUrl`, `expiresAt` (ISO timestamp), `profile`. `profile` is the alias. `loginUrl` matches `^https://cursor.com/loginDeepControl\?`. The pending file is `profiles/<alias>.pending.json`, mode `0600` where the platform allows it. Do not read it. It stores `uuid`, `verifier`, `loginUrl`, `expiresAt`, `profile`. The URL does not include `verifier`.

`--wait --json` success keys: `ok`, `profile`, `account`, `defaultAccount`, `credentialPath`, `accessTokenPresent`, `refreshTokenPresent`, `selectedTeamIdPresent`, `label`. `label` is the masked email, or `""` when `getMe` could not be read. In that case stderr says `Could not read an account label.` The tokens are not in the JSON. A successful login does not change `defaultAccount`. Human stdout is `Saved credentials for account <alias>` plus the path.

The same person under a different alias exits 3 with `ACCOUNT_ALREADY_ADDED` before the new credential file is kept.

## logout

```text
logout
```

Deletes the credential file and the pending file for the selected account. The registry row stays. Does not unset `GROK_BOT_ACCESS_TOKEN`. Missing files still exit 0, with `removed: false`. Human stdout is `Profile <alias> was already logged out`, or `Removed credentials for profile <alias>` when a file was removed.

```json
{"ok":true,"profile":"default","credentialPath":"/absolute/profiles/default.json","removed":false}
```

## accounts

```text
accounts list [--check]
accounts add <alias> [--start | --wait] [--no-open] [--timeout <seconds>]
accounts use <alias>
accounts rename <old> <new>
accounts remove <alias>
```

`accounts add` takes the alias as a positional argument. `--account` does not name the new alias. `--start` and `--wait` behave like `login`, including the success keys above. Use the same alias on both steps.

`accounts list --json`:

```json
{
  "ok": true,
  "default": "default",
  "accounts": [
    {"alias": "default", "label": "al***@example.com", "default": true, "credentials": true, "source": "file"}
  ]
}
```

`label` is a masked email: the first two characters of the local part, `***`, then `@domain`. The sample `al***@example.com` shows that shape. It is not a value from a particular machine. The label is `""` when the email is missing, has no `@`, or the local part or domain contains whitespace. `source` is `file`, `missing`, or `invalid`. `credentials` is true only for `file`. The list does not include `identityHash` or any token.

`accounts list --check` calls `getMe` for every account that has a credential and adds `check`. Success is `{"ok": true}`. Failure is `{"ok": false, "code": "NOT_LOGGED_IN"}` or another code such as `CREDENTIALS_INVALID`. One failed check does not fail the command. Exit code stays 0. A successful check can fill an empty `label`. It still does not print the identity.

`accounts use` sets the default. A credential file that is not registered yet is adopted and then set as the default. An unknown alias with no credential file is `ACCOUNT_NOT_FOUND`. Success keys: `ok`, `account`, `default`.

`accounts rename` renames the registry row, the credential file, and the pending file. The target must not already exist (`ACCOUNT_EXISTS`). Success keys: `ok`, `account` (the new alias), `previous`, `default`.

`accounts remove` deletes the credential, the pending login, and the registry row. If the removed alias was the default, the remaining aliases are sorted by name and the first becomes the default. If none remain, the default is the string `default` and `accounts.json` is kept, so a later command does not migrate the deleted profile back. Success keys: `ok`, `account`, `removed` (`true`), `default`. Run this only when the user asks.

There is no `accounts add` that skips the browser. Adding an account is a login.

## status

```text
status [--all-accounts]
```

One account, logged in:

| Key | Value |
| --- | --- |
| `ok` | `true` |
| `loggedIn` | `true` |
| `profile` | alias |
| `source` | `file` or `env` |
| `credentialPath` | absolute path of `profiles/<alias>.json` |
| `account.identityPresent` | `authId` or `userId` was non-empty |
| `account.emailPresent` | email was non-empty |
| `account.namePresent` | `name` or `displayName` was non-empty |
| `account.teamPresent` | `teamId` was present and not null |

The email, name, and ids are not printed. This `account` is an object. Do not confuse it with the alias string used by `--all-accounts`.

`status --all-accounts` asks every registered account. A successful row is `account` (alias string), `label`, `ok`, `loggedIn`, `source`, `credentialPath`, plus the four `*Present` fields. A failed row has `ok: false`, `loggedIn: false`, `source`, `credentialPath`, and `error: { code, message }`. The row does not include `exitCode`. Any successful account makes the command `ok: true` with exit 0. If every account fails, and there is at least one, `ok` is false, `error` is the first failure, and `error.exitCode` is the process exit code. `accounts` is still present. Zero registered accounts is `ok: true`, `accounts: []`, exit 0, and does not create `accounts.json`.

## Bot references

A ref is an id, a case-insensitive exact `name`, a unique case-insensitive fragment of `name`, or `<alias>:<id or name>`.

The alias is the text before the first colon. It counts as a prefix only when it exactly matches a registered alias. Otherwise the whole string is the name. `title` is not a match field.

Matching inside one account, in `matchBot`: exact id, then case-insensitive exact `name`, then a unique case-insensitive substring of `name`. Several matches at the winning step are ambiguous.

With no prefix and no `--account` / `--profile`, these commands search every logged-in account: `send`, `sessions`, `transcript`, `tasks`, `todos`, `skills`, `files`, `invites`, `watch`, `wait`, `relay`, and every `bot`, `room`, and `skill` subcommand. A logged-in account is a registered alias that has a credential file. A missing file is not searched and does not print a skip line. One hit uses that bot's account, including token refresh. Several hits are `AMBIGUOUS_BOT`. Candidates are sorted by `account`, then `name`, then `id`.

`bot delete`, `room delete`, `room remove-member`, `room set-members`, and `skill remove` turn exact matching on. An id or a full name still wins. Any substring hit, even a single one, is `AMBIGUOUS_BOT` and does not write. `room create` and `room add-member` still allow a unique fragment. `--room` uses this same matcher, then requires kind `2`, `ROOM`, or `GROK_BOT_AGENT_KIND_ROOM`.

An explicit `--account`, or a registered prefix, searches only that account. A logged-in account whose request fails is skipped, with stderr `Skipping account <alias>: <CODE>`, when some other account still matches. The command can still exit 0. When those failures are why nothing matches, the error is `BOT_NOT_FOUND` and `failedAccounts` lists `{ account, code }`. There is no skip line in that case. One explicit target returns that account's own error.

Each account's bot list is fetched once per process. `relay --dry-run` resolving both ends still fetches each account once.

## bots

```text
bots [--all-accounts]
```

One account. Success keys: `ok`, `account` (alias), `count`, `truncated`, `bots`. Each bot has only `id`, `name`, `title`, `kind`, `role`, `sessionId`. `name` is the match key. `title` is not.

`bots --all-accounts` fetches registered accounts in parallel. Live stdout order is `ok`, `bots`, `accounts`:

```json
{
  "ok": true,
  "bots": [
    {"account": "default", "id": "...", "name": "...", "title": "...", "kind": "...", "role": "...", "sessionId": "..."}
  ],
  "accounts": [
    {"account": "default", "label": "al***@example.com", "ok": true, "count": 1, "truncated": false}
  ]
}
```

A failed account row is `ok: false`, `count: 0`, `truncated: false`, and `error: { code, message }`. It has no `exitCode` and no `bots` array of its own. Bots from failed accounts are absent from the top-level `bots` array. Exit rules match `status --all-accounts`.

## sessions

```text
sessions --bot <ref>
```

Success keys: `ok`, `account`, `botId`, `count`, `sessions`. `sessions` is the SDK list, unchanged. Items include `agentId`, `sessionId`, `kind`, and may include `createdAtMs`, `updatedAtMs`, `lastActivityAtMs` (`string | null`). Human lines use `sessionId`, `kind`, and `lastActivityAtMs`.

## transcript

```text
transcript --bot <ref> [--session <id>] [--limit <n>]
```

`--limit` is an integer 1–500. Default 20.

Success keys: `ok`, `account`, `botId`, `generation`, `count`, `unreadAnchor`, `entries`. Each entry is `seq`, `updatedSeq`, `entryId`, `entryKind`, `bodyOmitted`, `text`. `text` is `body.content`, or else `body.message.content`, or else `null`. The raw body is not included. `unreadAnchor` is the SDK value or null.

`wait` reads this with `limit` fixed at 500. That window is not the `--limit` default of this command.

## tasks

```text
tasks --bot <ref> [--session <id>]
```

Success keys: `ok`, `account`, `botId`, `agentTasks`, `tasks`. Both arrays are SDK objects.

`agentTasks` items are SDK `AgentTask`: `id`, `name`, `description`, `status`, `updatedAtMs`, `unreadEntryId`, `unreadPreview`, `unreadAtMs`, `pinnedAtMs`, `subagentIds`.

`tasks` items are SDK `BotTask`: `id`, `title`, `state`, `note`, `createdAtMs`, `doneAtMs`, `seenDoneAtMs`.

An omitted `--session` becomes an empty string.

## todos

```text
todos --bot <ref>
```

Success keys: `ok`, `account`, `botId`, `count`, `todos`. SDK `AgentTodo`: `id`, `content`, `status`, `createdAtMs`, `updatedAtMs`, `dependencies`.

## skills

```text
skills --bot <ref>
```

Success keys: `ok`, `account`, `botId`, `count`, `skills`. Each skill is `id`, `name`, `description`, `source`, `body`. `body` is the skill text and can be large.

## capabilities

No command flags. Uses the selected account. Success keys: `ok`, `capabilities`. SDK `RuntimeCapabilities`: `durableIdentityEnabled`, `durableIdentityWritesEnabled`, `temporalCreationEnabled`, `agentMessagingEnabled`, `serverRoomsEnabled`.

## box

No command flags. Uses the selected account. Success keys: `ok`, `box`. SDK `SandBoxRunState`: `runState` (string), `imageUpdateAvailable` (boolean), `egressTunnelOwnership` (boolean), `image` (`{registryTag, staticSnapshotPath}` or null).

## send

```text
send --bot <ref> --text <text> [--session <id>] [--file <path>...]
     [--wait] [--timeout <seconds>] [--idle-timeout <seconds>]
```

`--text` must contain a non-space character. `--file` may be repeated. Each path must be readable. The CLI sends the absolute path and the base name through the SDK. `--timeout` must be a positive number up to 3600. `--idle-timeout` may be 0. Both require `--wait`. Defaults with `--wait`: timeout 600s, idle 2s. An omitted `--session` is an empty string. The request uses the bot's own account.

Without `--wait`, success keys: `ok`, `account`, `botId`, `messageId`, `delivery`, `dispatched`. `delivery` is `accepted-box`, `accepted-temporal`, or `duplicate`.

With `--wait`, the same keys plus `text` (the reply) and `endedBy`. `endedBy` is `agent-idle` or `status-idle`. `agent-idle` means the event stream went busy and then idle. `status-idle` means `listAgentStatuses` said the bot is not running after the reply went quiet (at most one check every 15 seconds). Text that arrives while the bot is still running is not the final reply. At the deadline, one more status check still counts as `status-idle` when the bot has stopped and some text has arrived. Otherwise the result is `TIMEOUT` and `text` holds whatever arrived. Human stdout is only `text`. `endedBy <reason>` is on stderr, and only when `--json` is absent.

The watch connects before the message is sent. A failed wait does not send the message a second time. On timeout the message stays accepted: exit 5, `error.code` `TIMEOUT`, `error.sent` true, `error.messageId` set. Continue with `wait`. Do not call `send` again.

`error.sent` is the field to trust. Exit 0 has sent. A failure with `error.sent: true` has also sent. `NOT_LOGGED_IN`, `USAGE`, `FILE_NOT_FOUND`, and `STREAM_CONNECTION_FAILED` are before the send (`sent: false` when the command got that far).

## wait

```text
wait --bot <ref> --message-id <id> [--session <id>] [--timeout <seconds>] [--idle-timeout <seconds>]
```

This command does not send. Defaults are the same 600s timeout (maximum 3600s) and 2s idle window.

It reads the newest 500 transcript entries. A reply is complete when assistant text sits strictly after the anchor and strictly before the next user turn. The anchor is the entry whose entry id or message id equals `--message-id`, or whose entry id equals `getSendStatus.echoEntryId`. A user turn is only a message whose role is `user`. A `send-message` entry is the bot's send-message tool and counts as a reply, including when it has no assistant role. Assistant text is also `role: assistant`, kind `assistant-text` / `assistant` / `assistant-message`, or kind `message` that is not a user turn. A streaming entry means the turn is still open. Matching texts are joined with a blank line. Echoes of the anchor text are dropped.

If that reply is already complete, success `endedBy` is `transcript` and `wait` does not open a watch. Otherwise it watches. After the watch connects it reads the transcript once more, so a reply that landed in that gap is not missed. If the anchor is older than the newest 500 entries, `wait` does not guess from earlier assistant text.

Success keys: `ok`, `account`, `botId`, `messageId`, `text`, `endedBy`. `endedBy` is `transcript`, `agent-idle`, or `status-idle`.

`wait`'s own timeout says `Timed out waiting for the reply.` It does not say a new message was sent. Run `wait` again. Do not `send`.

## relay

```text
relay --from <ref> --to <ref> --text <text> [--template <text>] [--rounds <n>]
      [--timeout <seconds>] [--idle-timeout <seconds>] [--dry-run]
```

One shot. Not a background forwarder. Each step uses the same default 600s timeout (maximum 3600s) and 2s idle window. `--rounds` is an integer from 1 to 10, default 1. That is N round trips, so 2N steps. Round 1 sends `--text` to `--from` and waits, then sends the reply to `--to` and waits. Above 1, the bots alternate. The first message is the raw `--text`. Later messages use the template. The default template is `{reply}`. `{fromName}` and `{fromAccount}` are the bot that produced the reply being forwarded, not the bot that receives it. Placeholders are replaced once, so `{reply}` inside the reply text is not expanded again. The first failure stops the command. A step is not sent again.

Each step posts as the user, on the account that owns that bot. The two bots may be on different accounts.

Success:

```json
{
  "ok": true,
  "steps": [
    {
      "step": 1,
      "account": "default",
      "botId": "...",
      "botName": "...",
      "sent": true,
      "messageId": "...",
      "text": "the reply",
      "endedBy": "agent-idle"
    }
  ]
}
```

`text` on a step is the reply, not the text that was sent. `sent: true` means `sendMessage` was accepted.

`--dry-run` resolves both bots and does not send:

```json
{
  "ok": true,
  "dryRun": true,
  "from": {"account": "default", "botId": "...", "botName": "..."},
  "to": {"account": "default", "botId": "...", "botName": "..."},
  "text": "the first message",
  "template": "{reply}"
}
```

`text` here is the raw `--text` that would be sent to `--from`.

A failure looks like:

```json
{
  "ok": false,
  "error": {
    "code": "TIMEOUT",
    "message": "...",
    "sent": true,
    "messageId": "...",
    "completedSteps": [],
    "exitCode": 5
  }
}
```

`completedSteps` uses the same step object as success. It does not include the step that failed. `error.sent` is only that failed step. An HTTP failure before the SDK accepts the send has `sent: false`. A timeout after acceptance has `sent: true` and `messageId`.

## watch

```text
watch --bot <ref> [--bot <ref>...] [--session <id>]
```

`watch` is the only command that accepts repeated `--bot`. The bots may belong to different accounts. There is no `watch --all-accounts`. `--session` applies to every bot. One Ctrl-C stops all of them. There is no `--timeout`.

`--json` writes one object per line:

```json
{"ok":true,"account":"default","botId":"bot-alpha","event":{"type":"message","data":{}}}
```

Human lines are `account`, `botId`, and the event text, separated by tabs. `event` is `{type, data}` plus `id` when the SDK event has one. Other `type` values the SDK can emit: `connected`, `heartbeat`, `entry`, `entry.unavailable`, `message.deleted`, `reset`, `resync-required`, `turn.failed`, `bot.state.changed`, `bot.updated`, `agent.state`, `computer.actions`, `box.state`, `page.title.changed`. A failure after streaming has started stops the other watches and writes the normal `ok: false` error.

## files

```text
files --bot <ref> [--page-token <token>]
```

Read-only. Calls `listAgentFiles` with `Bot.id`. `--page-token` is sent only when you pass it. A unique name fragment is allowed.

Success keys: `ok`, `account`, `botId`, `count`, `nextPageToken`, `totalBytes`, `canEdit`, `files`. Each file is `name`, `path`, `sizeBytes` (decimal string), `contentType`, `updatedAtMs` (`string | null`), `etag`. `totalBytes` is a decimal string. Human lines are `path`, `sizeBytes`, and `contentType`, separated by tabs. No files prints `(no files)`.

## invites

```text
invites --bot <ref>
```

Read-only. Calls `listAgentAccessInvites` with `Bot.id`. Success keys: `ok`, `account`, `botId`, `count`, `invites`, `capUsage`. Each invite is `email`, `expiresAtMs`, `lastSharedAtMs`, `createdAtMs`. Timestamps are `string | null`. `capUsage` is `{ used, limit }`. Human stdout is one email per line, or `(no invites)`. Do not paste that list into a log the user did not ask to see.

## bot

```text
bot create --name <name> [--description <text>] [--title <text>]
bot update --bot <ref> [--name <name>] [--description <text>] [--title <text>]
bot duplicate --bot <ref> [--name <name>]
bot delete --bot <ref> [--yes]
```

`create` uses the selected account and calls `createBot`. `--name` must contain a non-space character. An omitted `--description` or `--title` is not sent. Success keys: `ok`, `account`, `bot`, `harness`. `bot` is `{ id, serverId, name, title, kind, role }`. `id` is `Bot.id`. `serverId` is `Bot.serverId` and may be null. `harness` is the SDK string, such as `temporal` or `box`.

`update` resolves the bot, then calls `updateBot` with `id` set to `Bot.serverId` and `partialUpdate: true`. It does not send `Bot.id`. At least one of `--name`, `--description`, and `--title` is required. An empty `--description` is sent and can clear the description. A missing `serverId` exits 3 with `USAGE` and does not write: `Bot "<name>" (<id>) has no server id, so it cannot be updated.` Success keys: `ok`, `account`, `botId`, `serverId`, `bot`. `botId` is `Bot.id`.

`duplicate` calls `duplicateBot` with `botId` set to `Bot.id`. The copy keeps the description and settings. It does not keep chat history or the avatar. Success keys: `ok`, `account`, `sourceBotId`, `renamed` (`false` without `--name`), `bot`. With `--name`, the CLI calls `updateBot` on the copy's `serverId`, not the source's. `renamed` is `true` only after that rename succeeds. If the copy has no `serverId`, exit 3 `USAGE`, `error.duplicated` is `true`, and the message says the bot was copied and was not renamed. If the rename request fails, the message says the copy exists and `error.duplicated` is `true`. In both cases the copy is already on the account.

`delete` calls `deleteBot` with `Bot.id`. It is irreversible. There is no restore command. Without `--yes` the CLI resolves the bot and returns exit 0. It does not call delete:

```json
{"ok":true,"dryRun":true,"action":"bot delete","account":"default","botId":"...","botName":"...","kind":"..."}
```

Human stdout is `dry-run bot delete <account> <name> (<id>) <kind>`. `--yes` performs the delete. Success adds `id` and `"deleted": true`. `--dry-run` is not valid here. The missing `--yes` is the dry run. The ref must be an id or the full name.

Show the dry-run JSON to the user. Add `--yes` only after they explicitly agree, then run the same command again.

## room

```text
room create --name <name> [--description <text>] --member <ref> [--member <ref>...]
room add-member --room <ref> --user-id <id> [--user-id <id>...]
room delete --room <ref> [--yes]
room remove-member --room <ref> --user-id <id>... [--yes]
room set-members --room <ref> --member <ref>... [--yes]
```

`--room` uses the same ref rules as `--bot` and can be set only once. The record must be a room (`kind` `2`, `ROOM`, or `GROK_BOT_AGENT_KIND_ROOM`). Otherwise the code is `NOT_A_ROOM` and no write is sent.

`create` calls `createRoom`. Each `--member` is resolved to `Bot.id`. Members must use one account. With `--account` or `--profile`, the room is created on that account and every member must already be there. Without those flags, the members must share one account and the room is created on it. A unique name fragment is allowed. Success keys: `ok`, `account`, `bot`, `members`. Each member is `{ account, id, name }`.

`add-member` calls `addRoomMembers`. `roomId` is the room's `Bot.id`. `--user-id` is a human user id, an integer from 1 to 2147483647, and may be repeated. Success keys: `ok`, `account`, `roomId`, `userIds`, `bot`.

`delete`, `remove-member`, and `set-members` are irreversible. Without `--yes` they resolve their targets and return exit 0 with `"dryRun": true`. They do not write. `--dry-run` is rejected. There is no restore command. The room ref, and each `set-members` bot ref, must be an id or a full name.

| Subcommand | Dry-run `action` | Extra dry-run fields | `--yes` calls | Success adds |
| --- | --- | --- | --- | --- |
| `delete` | `room delete` | `account`, `roomId`, `roomName`, `kind` | `deleteRoom` with `Bot.id` | `id`, `deleted: true` |
| `remove-member` | `room remove-member` | those, plus `userIds` | `removeRoomMembers` | `removed: true`, `bot` (`null` when the server returns no agent) |
| `set-members` | `room set-members` | those, plus `members` (`{id, name}[]`) | `setRoomMembers` | `bot` |

`set-members` replaces the room's bot members. The CLI requires at least one `--member`, so a missing flag cannot clear the room. `memberAgentIds` are `Bot.id` values, not `serverId`. Each member must be on the room's account.

Show the dry-run JSON to the user. Add `--yes` only after they explicitly agree.

## skill add, skill update, skill remove

`skills --bot` still lists skills. These subcommands change one skill:

```text
skill add --bot <ref> --name <name> (--content <text> | --content-file <path>) [--description <text>]
skill update --bot <ref> --name <name> (--content <text> | --content-file <path>) [--description <text>]
skill remove --bot <ref> --name <name> [--yes]
```

`add` calls `addAgentSkill`. `update` calls `updateAgentSkill`. Pass `--content` or `--content-file`, not both. `--name` must not be empty. The file is read as UTF-8 after the bot resolves. An unreadable path is `FILE_NOT_FOUND`: `Cannot read skill content <path>`. The request uses `Bot.id`. A unique name fragment is allowed. Success keys: `ok`, `account`, `botId`, `name`, `skill`. `skill` is only `{ name, description, sourcePath }`. Content and plugin fields are not printed.

`remove` calls `removeAgentSkill` and is irreversible. There is no restore command. Without `--yes`, dry-run `action` is `skill remove`. Fields are `account`, `botId`, `botName`, `kind`, and `name`. The bot ref must be an id or the full name. With `--yes`, success adds `"removed": true`. Show the dry-run JSON to the user before adding `--yes`.

If the skill text is not the user's own words, show `--name`, `--description`, and the content source, and wait for a yes before `add` or `update`.

## Credential files

Do not read these. `accounts list` and `status` are the supported views.

| OS | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/grok-bot-cli/` |
| Linux | `$XDG_CONFIG_HOME/grok-bot-cli/` or `~/.config/grok-bot-cli/` |
| Windows | `%APPDATA%\grok-bot-cli\` |

`GROK_BOT_CONFIG_DIR` replaces that directory. Files:

| File | Contents |
| --- | --- |
| `profiles/<alias>.json` | Access token, refresh token, and optional team id. Mode `0600` where chmod works. |
| `profiles/<alias>.pending.json` | Pending login, including the verifier. |
| `accounts.json` | `version` (must be 1), `default`, and `accounts[]` of `{ alias, label, addedAt, lastUsedAt }`. It may also store `identityHash`, a SHA-256 of the account identity, so the same person cannot be added twice. The plaintext identity is not stored and is not printed. Tokens are not stored here. |

The first command that needs the registry, when `accounts.json` is absent and `profiles/*.json` already exists, registers those profile names. `*.pending.json` is not an account. The registry default is the literal `default`, including when `default.json` is not one of the files. Existing credential bytes are not rewritten. Help, version, and usage errors do not create `accounts.json`.

Writes of `accounts.json` go to a temporary file in that directory and then `rename`. The mode is `0600` where the platform allows it. On Windows a failed chmod is ignored.

`GROK_BOT_ACCESS_TOKEN`, when set and non-empty, replaces the access token of the selected account for this process only. Other accounts still use their files. It is not written to disk and is not refreshed. `status` for that account reports `source` `env`.

A saved refresh token is renewed with the desktop client's OAuth refresh request when it is close to expiry or a call returns HTTP 401. The refresh follows the account that owns the bot. A rejected refresh exits 2 and asks for `login` again.
