---
name: pan-release
description: Panopticon-specific stable vs canary release workflow from main
allowed-tools:
  - Bash
  - Read
---

# Panopticon Release Workflow

Use this skill when the user asks how to release Panopticon, whether they should use a `develop` branch, or how stable vs canary publishing works.

## Core policy

Panopticon develops directly on `main`.

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

## Notes

- Stable is for “ship this to normal users now.”
- Canary is for “publish a real prerelease without moving latest yet.”
- The GitHub workflow decides whether to publish `latest` or `canary` based on the tag format.
- If asked for docs, point to `docs/RELEASING.md`.
