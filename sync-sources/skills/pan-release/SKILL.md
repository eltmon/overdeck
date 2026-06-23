---
name: pan-release
description: Overdeck-specific stable vs canary release workflow from main
allowed-tools:
  - Bash
  - Read
---

# Overdeck Release Workflow

Use this skill when the user asks how to release Overdeck, whether they should use a `develop` branch, or how stable vs canary publishing works.

## Core policy

Overdeck develops directly on `main`.

`main` is the active development branch, not the stable channel by itself. A release only happens when someone intentionally cuts and pushes a tag.

Do not recommend GitFlow or a long-lived `develop` branch unless the user explicitly asks for a different workflow.

## Release channels

### Stable
- Version format: `X.Y.Z`
- Tag format: `vX.Y.Z`
- npm dist-tag: `latest`
- GitHub Release: normal release

### Canary
- Version format: `X.Y.Z-canary.N`
- Tag format: `vX.Y.Z-canary.N`
- npm dist-tag: `canary`
- GitHub Release: prerelease

## Preferred operator flow

1. Run:
   ```bash
   pan release check
   ```
2. Create a stable or canary release:
   ```bash
   pan release stable --version 0.7.1
   pan release canary --version 0.8.0-canary.1
   ```
3. Push intentionally:
   ```bash
   git push origin main
   git push origin v0.7.1
   ```

## What the CLI does

`pan release stable` and `pan release canary`:
- validate the version format
- require release-from-`main`
- require a clean working tree
- run preflight verification
- update `package.json`
- create a release commit
- create an annotated tag
- print push commands instead of pushing automatically

## Publishing (how a pushed tag actually ships)

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which **publishes
`@overdeck/core`, `@overdeck/contracts`, and `@overdeck/desktop` to npm and cuts
the GitHub Release with desktop binaries — automatically**. There is **no manual
`npm publish`, no token, and no OTP**:

- CI authenticates via **npm Trusted Publishing (OIDC)** — the workflow's
  `id-token: write` plus a Trusted Publisher configured on each package. The
  publish steps are retry-safe (skip a package if that version already exists).
- **Do NOT add `registry-url` or a `NODE_AUTH_TOKEN` to the npm job's
  `setup-node`.** `registry-url` writes a dummy `_authToken` into `.npmrc` that
  shadows OIDC and makes `npm publish` fail with a 404. (This broke the
  v0.30.0/v0.30.1 publishes; removing it was the fix.)

Prerequisites that must stay true or publishing breaks:
- Each `@overdeck/*` package has a **Trusted Publisher** on npmjs.com
  (GitHub Actions · `eltmon`/`overdeck` · `release.yml`).
- **No `workspace:*` in runtime `dependencies`** — bundled workspace packages
  (e.g. `@overdeck/contracts`) belong in `devDependencies`, or consumers'
  `npm install` fails with `EUNSUPPORTEDPROTOCOL`.
- `publishConfig.access: "public"` on every publishable package.

First-time setup for a brand-new package (npm org creation, the one-time
bootstrap publish, configuring the Trusted Publisher) and full publish
troubleshooting live in `docs/RELEASING.md`.

## Notes

- Stable is for “ship this to normal users now.”
- Canary is for “publish a real prerelease without moving latest yet.”
- The GitHub workflow decides whether to publish `latest` or `canary` based on the tag format.
- If asked for docs, point to `docs/RELEASING.md`.
