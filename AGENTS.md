# Agent notes — grok-bot-cli

Notes for an agent that edits this repository. Using the shipped skill to talk to a Grok Bot is [skills/grok-bot/SKILL.md](skills/grok-bot/SKILL.md). This file is about changing the CLI itself.

## Layout

| Path | Role |
| --- | --- |
| `src/` | CLI source. ESM, Node.js 22.13+. |
| `test/` | `node --test`. Mocked HTTP only. |
| `scripts/build.mjs` | Bundle `src/` plus `grok-bot-sdk` into one file. |
| `dist/` | Build output. Gitignored. |
| `skills/grok-bot/` | Agent skill. `bin/grok-bot.mjs` is the file users run. `npm run build` overwrites it. |
| `skills/grok-bot/references/commands.md` | Flag and JSON reference. Keep it aligned with `src/help.mjs`. |

`package.json` is `private`. Do not publish this package to npm. `grok-bot-sdk` is pinned in `devDependencies` and is inlined. The bundle must not import an npm package at runtime.

## Checks

```bash
npm install
npm test
npm run build
node scripts/check-skill-bin.mjs
node skills/grok-bot/bin/grok-bot.mjs --version
```

`--version` prints CLI `0.3.0` and target `0.78.1`. `check-skill-bin` requires `dist/grok-bot.mjs` and `skills/grok-bot/bin/grok-bot.mjs` to be the same bytes, and both `SHA256SUMS` files to match that hash.

A release tag `vX.Y.Z` needs a `## [X.Y.Z]` section in `CHANGELOG.md`. Preview it with:

```bash
node scripts/changelog-for-release.mjs v0.3.0
node scripts/pack-skill.mjs /tmp/grok-bot-cli-release
```

The zip root is `grok-bot/`. `.DS_Store` stays out.

## Hard constraints

- Do not call a live account. Tests stay on mocked HTTP. Do not create, update, duplicate, or delete a bot, room, or skill against a real account while changing this repo.
- Do not commit tokens, `profiles/*.json`, `accounts.json`, or a value of `GROK_BOT_ACCESS_TOKEN`.
- Do not put machine paths or real bot names in examples. Use `work`, `research`, `alice:assistant`, `bob:reviewer`.
- Do not add a command that pretends to edit a bot's instructions. That API is not wrapped. Do not add a restore command. Deletes are dry-run until `--yes`.
- `accounts remove` deletes local credentials only.
- Keep `.gitattributes`: text is LF, `*.cmd` and `*.ps1` are CRLF, `*.png` is binary.
- If a flag or JSON field changes, update `skills/grok-bot/references/commands.md`, `skills/grok-bot/SKILL.md`, `README.md`, `README_ZH.md`, and `README_RU.md` in the same change.
- The OAuth client id in `src/constants.mjs` is the public desktop client id. Leave it. Do not invent a second client.

## Protocol

The CLI targets Grok Bot **0.78.1** through `grok-bot-sdk` **0.78.1**. Bump that pin only when you mean to track a new SDK release, and say so in the changelog. The desktop protocol is unofficial and can change.
