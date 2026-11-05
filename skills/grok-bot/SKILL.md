---
name: grok-bot
description: >
  Use the grok-bot skill launcher to operate the user's own Grok Bot accounts.
  Trigger when the user wants to talk to their Grok Bot, send a message and wait for the reply,
  list bots across accounts, bridge two bots with relay, watch a long-running bot,
  create or change a bot, room, or skill, or add or initialize a grok-bot login.
  用户想和自己的 Grok Bot 对话、给 bot 发消息并等待回复、查看多账号 bot、把两个 bot 桥接起来、创建或修改 bot / 房间 / skill，或新增/初始化登录时使用。
---

# grok-bot

`grok-bot` talks to the user's own Grok Bot accounts. This CLI is 0.3.0 and targets protocol 0.78.1. The program is one JavaScript file shipped inside this skill. It does not embed a runtime. Agents pass `--json` on every account command and branch on the process exit code. Logs and progress go to stderr. Flags, JSON keys, and error codes are in [references/commands.md](references/commands.md). Read that file before the first command other than version, help, `status`, `accounts list`, or the login steps below.

中文：这是用户自己的账号。登录必须用户在浏览器里批准。发消息、以及下面的 `relay`，都是以用户身份对外发言。

An account is an alias. `--account <alias>` and `--profile <name>` are the same flag. If both are set and they differ, the command exits 3 with `USAGE`. With neither flag, the CLI uses the `default` alias in `accounts.json`, or the alias `default` when that file has no default yet.

## Skill directory

The skill directory is the directory that contains this `SKILL.md` file. Call the launcher inside it. Do not call a different `grok-bot` that happens to be on `PATH`.

For the rest of the session, set one variable and use it for every command:

```bash
GROK_BOT="<skill directory>/scripts/grok-bot"
"$GROK_BOT" --version
```

On Windows, set that variable to `<skill directory>\scripts\grok-bot.cmd` and call it the same way. `grok-bot.cmd` runs `grok-bot.ps1`. Examples below are written as `"$GROK_BOT"`.

## First run

The launcher picks a runtime, then runs `bin/grok-bot.mjs`:

1. `node` on `PATH` at version 22.13 or newer.
2. Otherwise `bun` on `PATH`, or `$BUN_INSTALL/bin/bun` when `BUN_INSTALL` is set, or `$HOME/.bun/bin/bun` (Windows: `%USERPROFILE%\.bun\bin\bun.exe`).
3. If neither exists, it installs Bun into that user directory. No administrator account. This can take tens of seconds and needs a network. Tell the user that Bun is being installed. Do not ask for permission first. 中文：先告知正在安装，不用先征求同意。

`GROK_BOT_RUNTIME=node` or `GROK_BOT_RUNTIME=bun` forces that runtime. `GROK_BOT_NO_AUTO_INSTALL=1` skips the install.

Install progress is on stderr. With `--json`, stdout is still only the CLI JSON.

If this fails, the process exits 3. stderr lists manual install commands for Node.js 22 LTS and for Bun. With `--json`, stdout is:

```json
{"ok":false,"error":{"code":"RUNTIME_INSTALL_FAILED","message":"..."}}
```

Stop there. Show the user `error.message` and the stderr commands, and ask whether they want to install Node.js or Bun by hand. Do not run the installer again until they answer.

Before the CLI starts, the launcher checks `bin/grok-bot.mjs` against `bin/SHA256SUMS` when `shasum`, `sha256sum`, `certutil`, or `Get-FileHash` is available. A mismatch exits 3. With `--json`:

```json
{"ok":false,"error":{"code":"CLI_CHECKSUM_MISMATCH","message":"grok-bot.mjs does not match SHA256SUMS."}}
```

Do not try to repair the file. Tell the user this skill copy is damaged.

A usable version command exits 0 and prints three lines. The third line is the runtime that actually started the file:

```text
grok-bot 0.3.0
grok-bot-target 0.78.1
runtime node v22.20.0
```

On Bun the third line is `runtime bun vX.Y.Z`. `"$GROK_BOT" --version --json` adds `runtime` and `runtimeVersion` (the version keeps the leading `v`). The CLI checks the runtime before `--version`. Exit 3 with `RUNTIME_UNSUPPORTED` means the chosen runtime is older than Node.js 22.13 or Bun 1.1. That is not an install failure. Show `error.message`.

## Login

Run `"$GROK_BOT" accounts list --json` and `"$GROK_BOT" status --json` before other account commands. You cannot approve the page, type a password, or click through the prompt for the user. 中文：不能代点授权，不能输入密码。

`status` for the selected account: exit 0 and `"loggedIn": true` means continue. `"source": "env"` means `GROK_BOT_ACCESS_TOKEN` overrides only that account's saved token for this process. Do not print it. Tell the user. `logout` does not clear it, and that token is not refreshed. Exit 2 with `NOT_LOGGED_IN`, `AUTH_REFRESH_FAILED`, `AUTH_REVOKED`, or `CREDENTIALS_INVALID`: do the two-step login below for that alias. Any other code: stop and show `error.message`. Do not start a login for a network error (exit 4).

This login updates the selected alias (default `default`). It does not add a second account. Adding one is the next section.

Step A, returns immediately:

```bash
"$GROK_BOT" login --start --json --no-open
```

Stdout keys are `ok`, `loginUrl`, `expiresAt`, and `profile`. `profile` is the alias. Show `loginUrl` to the user unchanged and ask them to open it and approve it. Do not fetch it. Do not fill the page. `--no-open` keeps this process from launching a browser. The URL is `https://cursor.com/loginDeepControl` with query keys `challenge`, `uuid`, `mode`, `redirectTarget`, `supportsSelectedTeamLogin`. It has no verifier and no token. `expiresAt` is when the pending login dies. The default lifetime is 900 seconds. `--timeout` on `--start` changes that lifetime, not the later wait.

Step B, after the user has the page open (you may start the wait as soon as you have shown the URL; the command blocks):

```bash
"$GROK_BOT" login --wait --json --timeout 300
```

Use the same alias on both steps. Default wait is 300 seconds. Stderr may say `Waiting for browser approval`. That is progress, not the result. Then run `status --json` again and continue only when `loggedIn` is true.

Do not run `login` without `--start` or `--wait`. It opens a browser and polls in one shot. Do not pass `--start` and `--wait` together.

| `--wait` result | Next step |
| --- | --- |
| Exit 0, then `status` has `loggedIn: true` | Done. The JSON has `accessTokenPresent`, `refreshTokenPresent`, `account`, `defaultAccount`, and `label`. It does not contain tokens. A successful login does not change which alias is the default. |
| `LOGIN_NOT_STARTED` (exit 3) | No pending login. Run `--start` again and show the new URL. |
| `LOGIN_EXPIRED` (exit 2) | Past `expiresAt`. Run `--start` again. Do not keep waiting. |
| `LOGIN_TIMED_OUT` (exit 5) | The user did not finish in time. Closing or refusing the page has no separate code; it shows up as this timeout or as `LOGIN_EXPIRED`. If `expiresAt` is still ahead, one more `--wait` is enough. Otherwise `--start` again. Tell the user. Do not loop. |
| `SIGN_IN_POLICY_VIOLATION` (exit 2) | The organization refused sign-in. Stop and tell the user. Do not start another login immediately. |
| `LOGIN_POLL_FAILED` (exit 4) | The poll failed. Tell the user. Retry `--wait` once only if the pending login is still inside `expiresAt`. |

## Accounts

An account is an alias in `accounts.json`, not a second install. `"$GROK_BOT" accounts list --json` is the safe list: `default`, and each row's `alias`, masked `label`, `default`, `credentials`, and `source` (`file`, `missing`, or `invalid`). Do not read `accounts.json` or `profiles/*.json`.

The user chooses the alias. If they did not name one, ask. If you still need a name to proceed, pick the next free short name such as `account2` and tell them that name before showing a URL. The alias is 1–64 characters: a letter or digit, then letters, digits, `_`, or `-`.

Add that alias with the same two steps. The positional alias is the new account. Do not pass it as `--account`.

```bash
"$GROK_BOT" accounts add <alias> --start --json --no-open
"$GROK_BOT" accounts add <alias> --wait --json --timeout 300
```

Give the user `loginUrl`. Tell them the browser must sign in as the account being added. If that browser is already signed into a different account, they switch accounts or use a private window before approving the page. 中文：提醒用户，浏览器里登录的必须是要新增的那个账号；已经登着别的号就先切换，或开无痕窗口。

`ACCOUNT_ALREADY_ADDED` (exit 3) means this person is already registered. `error.alias` and `error.account` are that existing alias. The new credential was not saved. Tell the user the existing alias. Do not invent another alias for the same person. If they meant a different person, they start again with `--start` after switching the browser account.

Same-alias login may replace that alias's credential. A new alias does not become the default. `accounts use <alias>` changes the default, and only when the user asks. `accounts rename` and `accounts remove` also only when the user asks. `remove` deletes the credential and the registration. `logout` deletes the credential and leaves the registration.

## Addressing

A bot ref is an id, a case-insensitive exact name, a unique case-insensitive name fragment, or `alias:id-or-name` when that alias is registered. The alias is the text before the first colon, and it must match a registered alias exactly. Otherwise the whole string is the name, because a name may contain colons. After a match, keep using `alias:id`.

With no prefix and no `--account` / `--profile`, `send`, `sessions`, `transcript`, `tasks`, `todos`, `skills`, `files`, `invites`, `watch`, `wait`, `relay`, and the `bot`, `room`, and `skill` subcommands search every logged-in account. One hit uses that bot's account. Several hits exit 3 with `AMBIGUOUS_BOT`. Show `error.candidates` (`account`, `id`, `name`) and ask the user. 中文：对上多个就问，不要自己选。 Then pass `alias:id`. On `BOT_NOT_FOUND`, show the list and ask. If `error.failedAccounts` is present, say which accounts could not be searched. Stderr `Skipping account <alias>: <CODE>` means some other account still matched; exit 0 is still success.

`bot delete`, `room delete`, `room remove-member`, `room set-members`, and `skill remove` accept only an id or a full name. A name fragment is `AMBIGUOUS_BOT` even when it matches one record. `--room` uses the same ref rules, and the record must be a room. Otherwise the code is `NOT_A_ROOM`.

`--account <alias>` searches only that account. A prefix for a different registered account, or `alias:` with an empty name, is `USAGE`.

## Aggregate lists

`"$GROK_BOT" bots --json` lists the selected account and includes `account` on the object. To see every registered account:

```bash
"$GROK_BOT" bots --all-accounts --json
```

Use `accounts[]` and `bots[]`. A row with `ok: true` contributes its bots. A row with `ok: false` has `error.code` and `error.message`. Exit 0 and top-level `ok: true` means at least one account succeeded. Tell the user which accounts failed, and still use the bots that came back. Do not hide a failed account. If every registered account failed, the command is `ok: false` and the exit code is `error.exitCode` (the first failure). `accounts[]` is still there. Zero registered accounts is exit 0 with both arrays empty.

`status --all-accounts --json` uses the same exit rule. One account's `status` is different: there `account` is `{ identityPresent, emailPresent, namePresent, teamPresent }`, and `profile` is the alias. Do not mix the two shapes.

## Relay

`relay` posts as the user, once into `--from`, then forwards that reply into `--to`. One round is two sends. It is not a resident forwarder. When the process exits, nothing keeps forwarding.

```bash
"$GROK_BOT" relay --from <ref> --to <ref> --text <exact text> --json
```

If the user already named both bots and the exact text, run that command. Do not add `--rounds` unless they asked for more than one round. The default is 1, and the maximum is 10. Each extra round sends the reply back and forth.

If they did not name both ends, or you drafted, shortened, or translated the text, do not send yet. Run the same arguments with `--dry-run` and show `from` (`account`, `botName`), `to`, and `text`. Wait for a yes, then run it without `--dry-run`. 中文：两端和第一条原文没有被用户说死时，先 dry-run，确认后再发。

`--template` defaults to `{reply}`. `{fromName}` and `{fromAccount}` name the bot that wrote the reply being forwarded. Set a template only when the user asked.

On failure, read `error.sent` and `error.completedSteps`. Steps in `completedSteps` already finished (`sent: true` on each). Do not send those again. `error.sent: true` means the step that failed was already accepted. Continue that step with `wait` when `error.messageId` is present. If `messageId` is missing, do not send again; read `transcript`. `error.sent: false` means that step was not accepted. Do not start a second `relay` that repeats finished steps.

## Long tasks

`send --wait`, `wait`, and each `relay` step default to `--timeout` 600 seconds (maximum 3600) and `--idle-timeout` 2 seconds. `send`'s timeout flags require `--wait`. When the user already says the reply will take a long time, pass a longer `--timeout` on that first command. Text received while the bot is still running is progress, not the final reply.

Exit 5 after `send --wait` means the wait timed out. If `error.sent` is true, the message was accepted. Do not send it again. Continue with the `wait` command from `error.message` (it includes `alias:botId` and `--message-id`):

```bash
"$GROK_BOT" wait --bot <alias:botId> --message-id <id> --json --timeout <seconds>
```

`wait` does not send. If `wait` itself exits 5, the reply is still not ready. Run `wait` again with a longer `--timeout` if the user still wants it. Do not fall back to `send`.

## Common flow

```bash
"$GROK_BOT" bots --all-accounts --json
"$GROK_BOT" sessions --bot <alias:id-or-name> --json
"$GROK_BOT" send --bot <alias:id> --text <exact text> --wait --json
"$GROK_BOT" transcript --bot <alias:id> --json
```

`bots` returns `count`, `truncated`, and `bots[]` with `id`, `name`, `title`, `kind`, `role`, `sessionId`. `--all-accounts` also puts `account` on each bot. If `truncated` is true, tell the user the list may be incomplete.

Omit `--session` unless the user named one. The CLI then sends an empty session id. If you must choose, run `sessions` and ask. Do not guess.

`send --wait` puts the reply in `text` and the stop reason in `endedBy`: `agent-idle` or `status-idle`. `agent-idle` is the event stream going busy and then idle. `status-idle` means a status check found the bot not running after the reply went quiet. `--idle-timeout 0` is allowed. Repeat `--file <path>` only for files the user asked to attach.

Use `transcript` when `text` is empty or you need earlier turns. `--limit` is an integer from 1 to 500. The default is 20. Each entry's `text` is a string or null.

Use `watch --bot <ref> --json` only when the user wants a long run followed live. Repeat `--bot` to follow more than one bot, including bots on different accounts. One interrupt stops all of them. There is no timeout flag and no `--all-accounts`. Stdout is one JSON object per line (`{"ok":true,"account":"...","botId":"...","event":{...}}`), not one JSON document. Prefer `send --wait` for a single reply.

When the user asks about those views, the same `--json` and login rules apply to `tasks --bot`, `todos --bot`, `skills --bot`, `files --bot`, `invites --bot`, `capabilities`, and `box`. `files` and `invites` only read. Bot, room, and skill writes are in the Safety section. Flag and JSON details are in [references/commands.md](references/commands.md).

## Output and errors

Always add `--json` for account commands. Success is one JSON object with `"ok": true`, except `watch --json`, which is NDJSON. A failure is one object on stdout. `error.exitCode` is the process exit code. `send` and `relay` also set `error.sent`. A failed `relay` also sets `error.completedSteps`.

```json
{"ok":false,"error":{"code":"NOT_LOGGED_IN","message":"Not logged in. Run: grok-bot login","profile":"default","credentialPath":"/absolute/profiles/default.json","exitCode":2}}
```

`profile` and `credentialPath` are only on the "not logged in yet" form. A rejected token is the same exit code with `Credentials were rejected. Run: grok-bot login` and no path. Without `--json`, the error line is on stderr and stdout is empty, so do not drop the flag. The code list is in [references/commands.md](references/commands.md).

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Success | Parse stdout. On `bots --all-accounts` or `status --all-accounts`, also read rows with `ok: false`. |
| 2 | Not logged in, or credentials were rejected | Follow the login section for that alias. `LOGIN_EXPIRED` starts over at `--start`. `SIGN_IN_POLICY_VIOLATION` stops. |
| 3 | Bad arguments, runtime, install, checksum, or a conflict the user must choose | `RUNTIME_INSTALL_FAILED`: ask about a manual Node.js or Bun install. `CLI_CHECKSUM_MISMATCH`: stop. `RUNTIME_UNSUPPORTED`: runtime is older than Node.js 22.13 or Bun 1.1. `AMBIGUOUS_BOT`: show `candidates` and ask. On a destructive command, a fragment match is this code even when one record matched; pass an id or the full name. `NOT_A_ROOM`: the ref is not a room. `ACCOUNT_ALREADY_ADDED`: tell them `error.alias`. `ACCOUNT_NOT_FOUND` / `ACCOUNT_EXISTS` / `ACCOUNTS_INVALID`: show `error.message` and stop. `LOGIN_NOT_STARTED` means run `--start`. `FILE_NOT_FOUND` means an attachment or `--content-file` is unreadable. `USAGE` means read `error.message` and fix that flag. A copy that exists but was not renamed has `error.duplicated: true`. |
| 4 | Network or server | Show `error.message`. Retry a read once. Do not retry `send` or `relay` when `error.sent` is true or `completedSteps` is non-empty. |
| 5 | Timeout | Login: use the login table. `send --wait` or a `relay` step with `error.sent` true: continue with `wait`. Do not send again. |

Branch on `error.sent` for `send` and `relay`. `true` means that message was accepted. `false` means it was not. `completedSteps` are the relay steps that already finished. If you are unsure whether a reply exists, read `transcript` or run `wait`. Do not post a second copy. 中文：超时或失败后不要把同一条再发一遍。

The CLI refreshes a saved refresh token by itself, for the account that owns the bot. Exit 2 after a failed refresh means login again. `GROK_BOT_ACCESS_TOKEN` is not refreshed.

`--help` and `--version` short-circuit. `"$GROK_BOT" status --version` prints the version and does not check login.

## Safety

- Do not print, log, upload, or quote credential files or `accounts.json`. Directory: macOS `~/Library/Application Support/grok-bot-cli/`, Linux `${XDG_CONFIG_HOME:-~/.config}/grok-bot-cli/`, Windows `%APPDATA%\grok-bot-cli\`. Credentials are `profiles/<alias>.json`. The pending login is `profiles/<alias>.pending.json` and holds the verifier. `accounts.json` stores aliases and a masked label. It does not store tokens. `GROK_BOT_CONFIG_DIR` replaces that directory. `accounts list --json` and `status --json` are the safe views.
- Do not set `GROK_BOT_ACCESS_TOKEN` unless the user handed you a token for this process. Never echo it. It overrides only the selected account.
- Sending speaks as the user. `relay` speaks in both bots, on whichever accounts those bots belong to. If they already named the bot and the exact text, send that text. If you drafted, shortened, or translated it, show the final `--text` and any `--file` paths, and wait for a yes. For `relay`, the dry-run in the Relay section is that confirmation. 中文：不是用户明确要发的原文，先确认再发。
- `files` and `invites` only read. `bot create`, `bot update`, `bot duplicate`, `room create`, `room add-member`, `skill add`, and `skill update` write to the account. If the name, description, title, member list, or skill text is not the user's own words, show the final flags and wait for a yes. `bot duplicate` copies the description and settings. It does not copy chat history or the avatar.
- `bot delete`, `room delete`, `room remove-member`, `room set-members`, and `skill remove` cannot be undone. There is no restore command. Run the command once without `--yes`. Exit 0 and `"dryRun": true` means nothing was written. Show that JSON to the user. Add `--yes` and run the same command again only after they explicitly agree. Do not pass `--yes` on the first run. A partial name is refused. Pass an id or the full name. 中文：删除、移除成员、覆盖成员、删除 skill 都不可恢复。先给用户看不带 `--yes` 的结果，用户明确同意后再加 `--yes`。
- Run `logout`, `accounts use`, `accounts rename`, or `accounts remove` only when the user asks. `logout` removes the local credential and a pending login. The alias stays registered. Missing credentials still exit 0, with `"removed": false`.
- Do not attach a file, or pass a `--content-file`, that the user did not name.

This skill does not call the SDK library, drive the desktop app, or click the login page.
