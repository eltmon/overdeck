# Panopticon Release Guide

Panopticon ships from `main`, but `main` is the active development branch — not the stable channel by itself.

A release only happens when you intentionally cut and push a tag.

## Branch and channel policy

- Do day-to-day work on `main`
- Commit freely, including intermediate or in-progress commits
- Treat **tags** as the promotion point from active development to something publishable
- Do **not** use GitFlow or a long-lived `develop` branch for normal Panopticon work

## Release channels

### Stable

Use stable releases when Panopticon feels good enough to publish for normal installs.

- Tag format: `vX.Y.Z`
- npm dist-tag: `latest`
- GitHub Release: normal release
- Example: `v0.7.1`

### Canary

Use canary releases when you want an explicit prerelease track without changing the day-to-day workflow on `main`.

- Tag format: `vX.Y.Z-canary.N`
- npm dist-tag: `canary`
- GitHub Release: prerelease
- Example: `v0.8.0-canary.1`

## Versioning guidance

- **Patch** (`x.y.Z`) for bug fixes, polish, and small improvements
- **Minor** (`x.Y.z`) for meaningful new capabilities that remain backwards compatible
- **Canary** (`x.y.z-canary.N`) when you want early validation before blessing a stable tag

## Golden path

### 1. Check release readiness

```bash
pan release check
```

This verifies:
- you are on `main`
- the working tree is clean
- `npm run build` passes
- `npm test` passes
- the release command is present in the built CLI

### 2. Create the release commit and tag

Stable:

```bash
pan release stable
pan release stable --version 0.7.1
```

Canary:

```bash
pan release canary
pan release canary --version 0.8.0-canary.1
```

When `--version` is omitted, Panopticon infers the next version from `package.json`:
- stable: next patch release (for example `0.7.0` → `0.7.1`)
- canary: next canary release (for example `0.7.0` → `0.7.1-canary.1`, `0.7.1-canary.1` → `0.7.1-canary.2`)

This command:
- validates the version format
- reruns preflight checks
- updates `package.json`
- creates a local commit
- creates an annotated local tag
- prints the push commands instead of pushing automatically

### 3. Push intentionally

Stable:

```bash
git push origin main
git push origin v0.7.1
```

Canary:

```bash
git push origin main
git push origin v0.8.0-canary.1
```

Pushing the tag triggers `.github/workflows/release.yml`.

## Drafting release notes

Use git history to draft notes:

```bash
pan release notes
pan release notes v0.7.0 HEAD
pan release notes v0.7.0 v0.7.1 --write .release/v0.7.1.md
```

The generated notes use a structured format:
- Summary
- Highlights
- Breaking changes
- Install
- Full changelog

## Workflow behavior

The GitHub release workflow distinguishes stable vs canary tags.

### Stable tags

For tags like `v0.7.1` the workflow will:
- install dependencies
- build the project
- smoke-test the CLI
- publish to npm `latest`
- build the Linux desktop app
- generate a structured release body from git history
- create a normal GitHub Release

### Canary tags

For tags like `v0.8.0-canary.1` the workflow will:
- install dependencies
- build the project
- smoke-test the CLI
- publish to npm with `--tag canary`
- build the Linux desktop app
- generate a structured release body from git history
- create a GitHub prerelease

## When to cut stable vs canary

Choose **stable** when:
- the current `main` snapshot is something you would recommend to normal users
- you want `npm install -g panopticon-cli` to pick it up by default

Choose **canary** when:
- you want testers to try a release candidate explicitly
- you want a publishable checkpoint without moving the stable channel yet
- you have meaningful new functionality but still want a prerelease buffer

## Troubleshooting

### `pan release check` fails on working tree cleanliness

Finish or revert the local changes first. Releases must start from a clean tree so the release commit and tag are deliberate.

### Build or tests fail during preflight

Fix the underlying issue before releasing. Do not cut a tag around broken verification.

### Tag already exists

Choose the next version. Tags are immutable release identifiers.

### npm publish or GitHub Release fails after tag push

Inspect the run in GitHub Actions for `.github/workflows/release.yml`. The release tag remains the source of truth, so fix the workflow or package issue and then decide whether to publish a new tag.
