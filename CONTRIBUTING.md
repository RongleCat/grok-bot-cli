# Contributing to grok-bot-cli

感谢关注 **grok-bot-cli**。欢迎 Issue、PR 和使用反馈。

Thanks for your interest in contributing.

## 开发环境 / Development

**Package manager:** npm. The lockfile is `package-lock.json`.

```bash
npm install
npm test
npm run build
node scripts/check-skill-bin.mjs
```

`npm test` uses mocked HTTP. It does not contact a real account and it does not create, edit, or delete a bot.

Node.js 22.13 or newer. Bun 1.1 or newer can run the built file:

```bash
bun skills/grok-bot/bin/grok-bot.mjs --version
```

The program is one file. `grok-bot-sdk` is a devDependency and is inlined by `npm run build`. Do not add a runtime dependency.

## 贡献流程 / Workflow

1. Fork the repository and create a branch.
2. Keep the change small and clear.
3. Run `npm test`, `npm run build`, and `node scripts/check-skill-bin.mjs` locally.
4. If a command, flag, or JSON field changed, update `skills/grok-bot/references/commands.md`, `skills/grok-bot/SKILL.md`, and the three READMEs together.
5. Open a pull request. Say why, what changed, and how you checked it.

## 约定 / Guidelines

- Product name in prose: **grok-bot**. Package name: `grok-bot-cli`. It stays `private`. This repository is not published to npm.
- Examples use placeholder names such as `work`, `research`, and `alice:assistant`. Do not commit real account names, emails, or bot names from your machine.
- Credentials live under the `grok-bot-cli` config directory (`GROK_BOT_CONFIG_DIR` overrides it). Do not commit `accounts.json`, `profiles/`, tokens, or logs that contain them.
- Destructive commands (`bot delete`, `room delete`, `room remove-member`, `room set-members`, `skill remove`) stay a dry run unless `--yes` is passed. Do not add a restore path that does not exist on the server.
- Line endings: `.gitattributes` keeps text as LF, except `*.cmd` and `*.ps1` (CRLF) and `*.png` (binary).
- Security issues go through [SECURITY.md](./SECURITY.md). Do not paste tokens into a public issue.

## 交流 / Contact

- X: [@cgnot996](https://x.com/cgnot996)
- GitHub Issues: https://github.com/RongleCat/grok-bot-cli/issues

## Releases

1. Add `## [X.Y.Z] - YYYY-MM-DD` to `CHANGELOG.md`.
2. Tag `vX.Y.Z`. The release workflow builds the skill zip from that tag.
3. The GitHub Release body is that CHANGELOG section (`scripts/changelog-for-release.mjs`).

Do not tag without a matching CHANGELOG section. The release job fails closed.
