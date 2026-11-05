# Changelog

## [0.78.1] - 2026-11-06

### Changed

- The CLI version now follows the Grok Bot version it targets, the same as [grok-bot-sdk](https://github.com/RongleCat/grok-bot-sdk). No functional changes from 0.3.0.

## [0.3.0] - 2026-11-05

First public release of the command line and the `grok-bot` agent skill.

### Added

- One JavaScript file for Node.js 22.13+ or Bun 1.1+. The [grok-bot-sdk](https://github.com/RongleCat/grok-bot-sdk) 0.78.1 package is bundled at build time. The running file has no npm dependencies.
- Multi-account roster. Log in as many accounts as you want. `bots --all-accounts` lists every bot. Address one as `account:bot`.
- Cross-account `relay`. One shot from one bot to another, including bots on different accounts.
- Agent skill. Any agent that can run a command can install `tiezhu-grok-bot-skill.zip` and talk to your bots. The launcher picks Node.js or Bun, and installs Bun into your user directory when neither is available.
- Read commands: `files`, `invites`, plus roster, transcript, tasks, todos, and skills.
- Write commands: `bot create`, `bot update`, `bot duplicate`, `room create`, `room add-member`, `skill add`, `skill update`.
- Irreversible commands stay a dry run until `--yes`: `bot delete`, `room delete`, `room remove-member`, `room set-members`, `skill remove`. A partial name is rejected. There is no restore command.
- `bot update` sends `Bot.serverId`. `bot duplicate` and room members send `Bot.id`. A copy keeps the description and settings. It does not keep chat history or the avatar.
- A transcript `send-message` entry counts as a bot reply. A user turn is only a message with `role` `user`.

## [0.2.0]

### Changed

- `send --wait`, each `relay` step, and `wait` default to a 600 second timeout. `--timeout` accepts at most 3600 seconds. Login `--wait` stays 300 seconds.
- A quiet assistant reply is checked with `listAgentStatuses`, at most once every 15 seconds. If that bot is not running, the wait ends with `endedBy: "status-idle"`. Text that arrives while the bot is still running is kept, and is not treated as the final reply. At the deadline, one more status check still counts as success when the bot has stopped and some text has arrived.
- The process no longer calls `process.exit()` on the normal path. It sets `process.exitCode`, cancels watch readers, drops the fetch dispatcher, flushes stdout, and lets the event loop end. This avoids the Windows libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)` ([nodejs/node#56645](https://github.com/nodejs/node/issues/56645), [nodejs/node#64322](https://github.com/nodejs/node/issues/64322)), which replaced a timeout's exit code 5 with status 1. A 2 second unref timer is the only fallback that still calls `process.exit()`.
