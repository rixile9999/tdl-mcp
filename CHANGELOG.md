# Changelog

## Unreleased

- **Requires Node.js 22 or later** (Node 18 and 20 are end-of-life). CI now
  runs on Node 22/24/26.
- `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1 and `zod` 3 → 4. `npm audit`
  is clean again (the 8 advisories were in SDK code paths this stdio-only
  server doesn't use).
- Release workflow: npm trusted publishing (OIDC) with provenance, fixed
  the `mcp-publisher` download (it matched two release assets), and failed
  releases can be re-run safely.
- Maintainer docs: corrected the `UPDATE_PR_TOKEN` requirements — without it
  the weekly tdl bump PR can't be opened at all.

## 1.0.0 — 2026-06-12

Initial open-source release.

- Five read-only tools: `tg_status`, `tg_chats`, `tg_messages`, `tg_download`,
  `tg_download_url`, wrapping the [tdl](https://github.com/iyear/tdl) CLI.
- Tested against tdl v0.20.3 (pinned in `.tdl-version`).
- Login-free smoke test (`npm run smoke`) and tdl CLI contract test
  (`npm run contract`).
- CI on Node 18/20/22; scheduled tdl release watcher with automatic
  version-bump PRs and AI-assisted upgrade escalation.
