[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/rixile9999-tdl-mcp-badge.png)](https://mseep.ai/app/rixile9999-tdl-mcp)

# tdl-mcp

[![CI](https://github.com/rixile9999/tdl-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rixile9999/tdl-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/tdl-mcp)](https://www.npmjs.com/package/tdl-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Read-only Telegram access for Claude and other MCP hosts, powered by the
[`tdl`](https://github.com/iyear/tdl) CLI.**

List your chats, read recent messages, and download media — from your own
Telegram account — with five simple tools. It never sends messages, never
modifies anything, and never touches your login.

🇰🇷 [한국어 문서는 여기 있습니다 → README.ko.md](README.ko.md)

## Why tdl-mcp?

Most Telegram MCP servers embed an MTProto library (Telethon, gramjs, …),
ask you to create your own Telegram application at `my.telegram.org` to get an
`api_id`/`api_hash`, and many of them can *send* messages on your behalf.

`tdl-mcp` takes a different, deliberately boring approach:

- **Read-only by design.** The server can list chats, export messages and
  download files. That's all. There is no code path that sends, edits,
  deletes, or logs in.
- **No `api_id`/`api_hash` setup.** Login is handled once, by you, in your
  terminal with `tdl login -T qr` — scan a QR code with your phone and you're
  done. No Telegram app registration needed.
- **Built on a battle-tested downloader.** [`tdl`](https://github.com/iyear/tdl)
  (7.5k+ ⭐) does the heavy lifting: fast parallel downloads, resume,
  `--skip-same` deduplication.
- **Tiny and auditable.** One plain-JavaScript file, two dependencies
  (`@modelcontextprotocol/sdk`, `zod`), no build step. You can read the whole
  server in five minutes.

```
Claude / MCP host  ←stdio→  tdl-mcp (Node)  →subprocess→  tdl CLI  →MTProto→  Telegram
```

## Quick start

### 1. Install tdl

```sh
# macOS
brew install telegram-downloader

# Linux / WSL
curl -sSL https://docs.iyear.me/tdl/install.sh | sudo bash

# Windows (PowerShell)
iwr -useb https://docs.iyear.me/tdl/install.ps1 | iex
```

Any version from the one pinned in [`.tdl-version`](.tdl-version) upward
should work — CI continuously tests against that pin (see
[Compatibility](#compatibility--staying-up-to-date)).

### 2. Log in to Telegram (once)

```sh
tdl login -T qr
```

Scan the QR code with the Telegram mobile app
(**Settings → Devices → Link Desktop Device**). The session is stored in
`~/.tdl` on your machine and shared by every MCP host — you log in exactly
once. `tdl-mcp` itself never performs or refreshes logins.

### 3. Add the server to your MCP host

You need Node.js ≥ 18.

**Claude Code:**

```sh
claude mcp add --scope user telegram -- npx -y tdl-mcp
```

**Claude Desktop / any other MCP host** (generic `mcpServers` JSON):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "tdl-mcp"]
    }
  }
}
```

### 4. Try it

Ask your assistant things like:

> *"What Telegram chats do I have? Find the one about quant trading."*
>
> *"Show me the last 20 messages in @some_channel."*
>
> *"Download every PDF posted in that channel since message 1500 to ~/Papers."*

If a tool reports that you are not logged in, run `tdl login -T qr` in a
terminal and retry — that's the only manual step there is.

## Tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `tg_status` | — | Checks whether the tdl session is logged in. Never errors: returns `{logged_in:true, chats:N}` or `{logged_in:false, hint}`. |
| `tg_chats` | `filter?` | Lists dialogs as `[{id, type, name, username}]`; `filter` is a case-insensitive substring match on name/username/id. |
| `tg_messages` | `chat`, `last_n?` (default 50, max 500), `since_id?`, `with_text?` (default true) | Exports recent media messages from a chat as compact `{id, date, file, text}` objects (at most 200 returned; truncation is noted). `since_id` fetches only messages after a known id — handy for incremental reads. |
| `tg_download` | `chat`, `since_id?`, `last_n?` (default 100), `extensions?` (csv, e.g. `"xlsx,pdf"`), `dest?` (default `~/Downloads/telegram`) | Downloads media from a chat with `--skip-same`; returns absolute paths of newly downloaded files, or a friendly "no matching files" note. |
| `tg_download_url` | `urls` (array of `https://t.me/...` links), `extensions?`, `dest?` | Downloads the media of specific messages by link. Validates every url starts with `https://t.me/`. |

`chat` accepts either a numeric id or an `@username`/domain, exactly as shown
by `tg_chats`.

## Environment variables

| Variable | Effect |
| --- | --- |
| `TDL_BIN` | Path to the tdl binary. Default: `tdl` on `PATH`, falling back to `/opt/homebrew/bin/tdl` (GUI-launched MCP hosts often don't inherit the Homebrew `PATH`). |
| `TDL_NS` | tdl namespace, passed as `-n <ns>` on every call. Use it to keep separate Telegram accounts/sessions apart. |

Set them in your host's server config, e.g.:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "tdl-mcp"],
      "env": { "TDL_NS": "work" }
    }
  }
}
```

## Compatibility & staying up to date

`tdl-mcp` shells out to the tdl CLI, so its real dependency is tdl's
command-line surface. That surface is guarded automatically:

- [`.tdl-version`](.tdl-version) pins the tdl release this package is tested
  against.
- [`scripts/contract.mjs`](scripts/contract.mjs) verifies — without logging in —
  that every flag the server uses (`chat ls -o json`, `chat export
  -c/-T/-i/-o/--with-content`, `dl -f/-u/-i/-d/--skip-same`, global `-n`)
  still exists in that tdl binary. CI runs it on every push and PR.
- A scheduled workflow watches [tdl releases](https://github.com/iyear/tdl/releases).
  When a new version appears it runs the contract test against the new binary
  and scans the release notes for breaking-change markers. Routine updates
  become a simple version-bump PR; anything suspicious is escalated to an
  AI-assisted upgrade PR that adapts the wrapper code.

So if you're on a newer tdl than the pin, chances are excellent everything
just works — and if it ever wouldn't, this repo finds out before you do.

## Development

```sh
git clone https://github.com/rixile9999/tdl-mcp.git
cd tdl-mcp
npm install
npm test          # smoke (MCP protocol, login-free) + contract (tdl CLI surface)
```

- `npm run smoke` spawns the server over stdio and checks the tool catalog,
  `tg_status` shape, and input validation — passes whether or not you are
  logged in.
- `npm run contract` checks the installed tdl binary against the CLI surface
  the server uses. `scripts/install-tdl.sh [vX.Y.Z]` installs a specific
  (checksum-verified) tdl release if you want to test against another version.

PRs welcome. Please keep the server read-only — tools that send, edit or
delete are out of scope for this project.

## Security notes

- The tdl session in `~/.tdl` is a **full user-account credential** — anyone
  who can read it can act as your Telegram account. Protect it like an SSH
  key: don't copy it into repos, shared backups, or other machines.
- `tdl-mcp` never reads or transmits the session itself; it only runs the
  `tdl` binary locally. Nothing leaves your machine except tdl's own Telegram
  traffic.
- Downloads go to a directory you choose (`dest`), defaulting to
  `~/Downloads/telegram`.

## Telegram terms-of-service note

tdl drives a regular user session (MTProto), not a bot. Quiet, read-only,
personal-use automation of your own account is generally tolerated, but
aggressive crawling can get an account limited: keep ranges modest
(`last_n`, `since_id`), avoid large parallel pulls, and let `--skip-same` do
its job instead of re-downloading.

## License

[MIT](LICENSE) for everything in this repository.

`tdl` itself is a separate project licensed under
[AGPL-3.0](https://github.com/iyear/tdl/blob/master/LICENSE). `tdl-mcp` does
not bundle, link, or modify tdl — it invokes the binary you installed as a
separate process, so the AGPL applies to tdl, not to this wrapper. You install
tdl yourself through official channels (step 1 above).
