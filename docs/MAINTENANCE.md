# Maintainer notes

Everything a maintainer needs to operate this repo. Users never need this file.

## Repository secrets

| Secret | Used by | What it is |
| --- | --- | --- |
| `NPM_TOKEN` | `release.yml` (bootstrap only) | npm **granular** access token with read/write package access and **Bypass 2FA** enabled, used only until trusted publishing is configured (see [npm publishing](#npm-publishing)). Delete it afterwards. |
| `UPDATE_PR_TOKEN` | `tdl-update.yml` | Fine-grained PAT scoped to this repo with **Contents**, **Pull requests** and **Issues: read/write** (Issues is for the AI path's "can't support this release" issue). Without it the workflow falls back to `GITHUB_TOKEN`, which fails to open PRs unless *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests* is on — and even then those PRs [don't trigger CI](https://docs.github.com/en/actions/using-workflows/triggering-a-workflow#triggering-a-workflow-from-a-workflow). |
| `DASHSCOPE_API_KEY` | `tdl-update.yml` (AI path only) | Alibaba Cloud Model Studio API key. Must be an **international-mode key created in the Singapore region** ([console](https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key), [docs](https://www.alibabacloud.com/help/en/model-studio/get-api-key)). Spent only when a tdl release fails the contract test or carries breaking markers. |

## Releasing a version

1. Update `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit to `main`, then tag and push:

   ```sh
   git tag v1.2.3 && git push origin main v1.2.3
   ```

3. `release.yml` takes it from there: verifies the tag matches
   `package.json`, runs the full test suite against the pinned tdl, publishes
   to npm (with provenance), creates the GitHub release, and republishes
   `server.json` to the official MCP Registry via `mcp-publisher` using
   GitHub **OIDC** — no registry credentials are stored anywhere.
   Re-running a failed release is safe: the npm and GitHub release steps
   skip themselves if that version already exists.

### npm publishing

npm revoked classic tokens in December 2025, and write-enabled granular
tokens now expire after at most 90 days, so a stored `NPM_TOKEN` is only a
bootstrap. The steady state is **trusted publishing** (GitHub OIDC, no
secret):

1. **First publish only:** create a granular token (npmjs.com → Access
   Tokens → Generate New Token; Packages and scopes: Read and write, All
   packages; Bypass 2FA checked; short expiry) and store it as `NPM_TOKEN`.
   Trusted publishing can't be configured until the package exists.
2. Push the release tag. `release.yml` publishes with the token.
3. Right after it succeeds, delete the `NPM_TOKEN` secret and revoke the
   token — nothing needs it until the next release.
4. **Before the next release** (same day you tag it): npmjs.com → `tdl-mcp`
   → Settings → **Trusted Publisher** → GitHub Actions: user `rixile9999`,
   repository `tdl-mcp`, workflow `release.yml`, no environment, and allow
   `npm publish`. A new configuration must see a successful publish within
   2 days or it expires (delete and recreate it if that happens). Once that
   release publishes, set Publishing access to *Require two-factor
   authentication and disallow tokens*.

`release.yml` needs no change between these phases: npm tries OIDC first and
falls back to `NODE_AUTH_TOKEN` only when no trusted publisher matches.

The registry name is `io.github.rixile9999/tdl-mcp`; GitHub OIDC automatically
grants publish rights for the `io.github.rixile9999/*` namespace, and npm
ownership is proven by the `mcpName` field in `package.json`. Verify a publish
with:

```sh
curl -s 'https://registry.modelcontextprotocol.io/v0.1/servers?search=tdl-mcp'
```

## How the tdl auto-update works (`tdl-update.yml`)

Every Monday (and on manual dispatch):

1. Compare `.tdl-version` against the latest [iyear/tdl release](https://github.com/iyear/tdl/releases).
2. If newer and no `tdl-bump/<version>` PR exists yet (open **or** closed —
   a closed bump PR means "rejected", so it won't be re-proposed):
   - install the new binary (checksum-verified) and run
     `scripts/contract.mjs` against it;
   - collect all upstream release notes since the pin and scan for tdl's
     historical breaking markers (`BREAKING`, `CLI BREAK`, `feat!(...)`-style
     bang commits — tdl has no CHANGELOG file or dedicated breaking section).
3. **Cheap path** (contract passes, no markers): plain `.tdl-version` bump PR.
   CI on that PR re-runs smoke + contract with the new version. Zero AI cost.
4. **AI path** (contract fails or markers found): `anthropics/claude-code-action@v1`
   runs Claude Code against **DashScope's Anthropic-compatible endpoint**
   (`https://dashscope-intl.aliyuncs.com/apps/anthropic`, model
   `qwen3.5-plus`), reads the notes and contract output, adapts
   `server.js`/`scripts/contract.mjs`, gets `npm test` green, and opens a PR —
   or an issue if the release can't be supported.

DashScope wiring notes (verified 2026-06):

- The key is passed through the action's `anthropic_api_key` input (sent as
  `X-Api-Key`, which DashScope accepts). The base URL and `ANTHROPIC_DEFAULT_*`
  model-tier vars go in step-level `env:` — the action forwards exactly those.
- `CLAUDE_CODE_SUBAGENT_MODEL` is pinned via the `settings` input to work
  around [claude-code-action#1258](https://github.com/anthropics/claude-code-action/issues/1258)
  (subagent calls otherwise send a literal `claude-*` model name, which
  DashScope 404s).
- The legacy `…/api/v2/apps/claude-code-proxy` endpoint is deprecated and
  hardwired to one model — don't use it.
- China-mainland accounts use `https://dashscope.aliyuncs.com/apps/anthropic`
  and the newer `qwen3.7-max`/`qwen3.6-flash` models instead.

## Directory listings

- **MCP Registry** — automatic on every release (above). This is the one
  registries/clients actually consume; the old `modelcontextprotocol/servers`
  README list is deprecated.
- **Glama** — auto-indexes the repo; `glama.json` claims ownership.
- **PulseMCP / mcp.so** — one-time manual submission via the Submit buttons on
  [pulsemcp.com](https://www.pulsemcp.com) and [mcp.so](https://mcp.so).
- **Smithery** — skipped: it now targets remote/hosted servers, which this
  stdio server is not.

## Dependency updates

`dependabot.yml` covers npm packages and GitHub Actions weekly. tdl itself is
not an npm dependency — it's tracked by `tdl-update.yml` above.
