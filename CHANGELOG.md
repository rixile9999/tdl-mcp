# Changelog

## 1.0.0 — 2026-06-12

Initial open-source release.

- Five read-only tools: `tg_status`, `tg_chats`, `tg_messages`, `tg_download`,
  `tg_download_url`, wrapping the [tdl](https://github.com/iyear/tdl) CLI.
- Tested against tdl v0.20.3 (pinned in `.tdl-version`).
- Login-free smoke test (`npm run smoke`) and tdl CLI contract test
  (`npm run contract`).
- CI on Node 18/20/22; scheduled tdl release watcher with automatic
  version-bump PRs and AI-assisted upgrade escalation.
