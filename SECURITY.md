# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |

## Reporting a Vulnerability

If you find a security issue in grok-bot-cli (token leakage, credential files written with loose permissions, secrets printed in `--json`, or the skill launcher running an unexpected file), report it privately:

- Open a [GitHub Security Advisory](https://github.com/RongleCat/grok-bot-cli/security/advisories/new) on RongleCat/grok-bot-cli, or
- Contact the maintainer on X: [@cgnot996](https://x.com/cgnot996)

Please include:

- A clear description of the issue
- Steps to reproduce, using placeholder account names
- Impact, if you know it

Do **not** open a public issue for a sensitive vulnerability until a fix is available.

**Do not paste credentials.** That includes access tokens, refresh tokens, the pending-login verifier, `profiles/*.json`, `accounts.json`, `GROK_BOT_ACCESS_TOKEN`, and screenshots of those files. A redacted `--json` error is enough. The CLI is written so those fields are not printed. If a bug made one appear, describe the field name and stop there.

## Local security notes

- Credentials stay on this machine. The CLI does not upload them to this project, and it has no telemetry.
- Paths (override the directory with `GROK_BOT_CONFIG_DIR`):
  - macOS: `~/Library/Application Support/grok-bot-cli/profiles/<alias>.json`
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/grok-bot-cli/profiles/<alias>.json`
  - Windows: `%APPDATA%\grok-bot-cli\profiles\<alias>.json`
- `accounts.json` stores aliases, a masked label, and an identity hash. It does not store tokens.
- `profiles/<alias>.pending.json` holds the login verifier. Do not read it, log it, or attach it to an issue.
- Files are mode `0600` where the platform allows it. Windows permissions are best-effort.
- `GROK_BOT_ACCESS_TOKEN` overrides only the selected account, for that process. It is not written to disk and is not refreshed.
- A saved refresh token is renewed with the desktop client's OAuth refresh request. A rejected refresh exits 2 and asks you to log in again.
- `bot delete`, `room delete`, `room remove-member`, `room set-members`, and `skill remove` do nothing until `--yes`. There is no restore command.
- `accounts remove` deletes the local credential and the local registry row. It does not delete bots or chats on the account.
- The skill zip is published with `SHA256SUMS.txt`. The launcher also checks `skills/grok-bot/bin/SHA256SUMS` before it starts `grok-bot.mjs`. A mismatch exits 3 with `CLI_CHECKSUM_MISMATCH`. Do not "fix" a mismatch by editing the file.
- This project is not an official xAI or Cursor product. Login uses your own account in the browser. The OAuth client id in the source is the public client id of the Grok Bot desktop client.
