# Overdeck Release Guide

Overdeck ships from `main`, but `main` is the active development branch — not the stable channel by itself.

A release only happens when you intentionally cut and push a tag.

## Branch and channel policy

- Do day-to-day work on `main`
- Commit freely, including intermediate or in-progress commits
- Treat **tags** as the promotion point from active development to something publishable
- Do **not** use GitFlow or a long-lived `develop` branch for normal Overdeck work

## Release channels

### Stable

Use stable releases when Overdeck feels good enough to publish for normal installs.

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

When `--version` is omitted, Overdeck infers the next version from `package.json`:
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

## Publishing to npm

Three packages publish together, all public under the `@overdeck` scope:

| Package | What it is |
| --- | --- |
| `@overdeck/core` | The engine + the `overdeck` / `pan` CLI command |
| `@overdeck/contracts` | Shared types/contracts (bundled into `core`'s `dist`) |
| `@overdeck/desktop` | The Electron Command Deck app (`npx @overdeck/desktop`) |

The end-user launch command is **`npx @overdeck/core`** (or `npm i -g @overdeck/core` → `overdeck up`; `pan up` is the alias).

### How CI authenticates (steady state)

`.github/workflows/release.yml` publishes with **npm Trusted Publishing (OIDC)** — `npm publish --provenance --access public`, with **no `NODE_AUTH_TOKEN`**. The workflow's `id-token: write` permission lets npm verify the publisher against each package's trusted-publisher config (this repo + `release.yml`). Each publish step is retry-safe: if `name@version` already exists on npm, it skips that package.

So once Trusted Publishing is configured per package, publishing is hands-off: `pan release stable` → push tag → CI publishes. No tokens, no OTP.

### One-time setup per new package (bootstrap)

Trusted Publishing can only be configured for a package that **already exists** on npm — a chicken-and-egg for a brand-new scope. Bootstrap each package once:

1. **Create the org/scope** (once for the whole scope): npmjs.com → Add Organization → `overdeck` → Free (unlimited public packages). This claims `@overdeck`.
2. **Cut the release** so the version + tag exist: `pan release stable --version X.Y.Z`, then `git push origin main` (**not** the tag yet).
3. **Bootstrap-publish each package once**, authenticated as an org member (see "Authenticating a manual publish" below). From a clean `main`:
   ```bash
   npm run build
   npm publish                               # @overdeck/core
   ( cd packages/contracts && npm publish )  # @overdeck/contracts
   ( cd apps/desktop && npm publish )        # @overdeck/desktop
   ```
   `publishConfig.access=public` is set on all three, so no `--access` flag is needed. Order doesn't matter — there are no runtime cross-deps between them.
4. **Configure Trusted Publishing** for each — npmjs.com → package → Settings → Trusted Publisher → GitHub Actions:
   - Organization/user: `eltmon`
   - Repository: `overdeck`
   - Workflow filename: `release.yml`
5. **Push the tag** to produce the binaries + GitHub Release: `git push origin vX.Y.Z`. CI sees the versions already on npm, skips the publishes, and still builds the desktop binaries + GitHub Release.

After step 4 the bootstrap is never repeated — all future releases use the steady-state flow above.

### Authenticating a manual publish

For the bootstrap (or an emergency manual publish), authenticate with a **Granular Access Token** — it bypasses the 2FA OTP prompt that blocks scripted publishes:

- npmjs.com → Access Tokens → Generate → **Granular Access Token**
- Short expiry; **Packages and scopes: Read and write** on scope `@overdeck`
- `npm config set //registry.npmjs.org/:_authToken=npm_xxxxx`
- **Revoke it after the bootstrap** — Trusted Publishing handles everything thereafter. (`npm config delete //registry.npmjs.org/:_authToken` clears the local copy.)

### Package hygiene the publish depends on

- **No `workspace:*` in runtime `dependencies`.** npm does not understand the `workspace:` protocol, so such a dep ships unresolvable and breaks `npm install` with `EUNSUPPORTEDPROTOCOL`. A workspace package that is *bundled* into a published package's `dist` (e.g. `@overdeck/contracts` is bundled into `@overdeck/core`) must stay in `devDependencies`, never `dependencies`.
- **`publishConfig.access: "public"`** on every publishable package — scoped packages default to restricted/private and the publish 402s otherwise.
- **The no-loss route matrix is a release gate.** Adding an HTTP route requires a matching entry in `tests/unit/lib/overdeck/no-loss-matrix.ts` (route + door/reason); `npm test` — and therefore `pan release check` — fails until the route is registered.

## When to cut stable vs canary

Choose **stable** when:
- the current `main` snapshot is something you would recommend to normal users
- you want `npm install -g @overdeck/core` to pick it up by default

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

### Manual `npm publish` returns `404 Not Found` on the `PUT`

This is npm's response (it returns 404 rather than 403 to avoid leaking scope existence) when the authenticated credential **cannot write to the `@overdeck` scope** — a read-capable token that lacks publish rights, an expired login, or no token at all. `npm whoami --registry https://registry.npmjs.org` returning `401` confirms it. Re-authenticate with a Granular Access Token that has **read and write** on `@overdeck` (see "Authenticating a manual publish").

### A CI publish fails for a brand-new package

Trusted Publishing must be configured per package, and that requires the package to already exist. Bootstrap it once manually (see "One-time setup per new package"), then add the trusted publisher.

### `npm install -g @overdeck/core` fails with `EUNSUPPORTEDPROTOCOL` / `workspace:`

A workspace package leaked into runtime `dependencies` as `workspace:*`. npm can't resolve that protocol. Move the offending dep to `devDependencies` (it's bundled into `dist` at build time) and cut a new patch release. See "Package hygiene the publish depends on".

### `pan release check` fails tests on the no-loss matrix

A new HTTP route isn't registered in `tests/unit/lib/overdeck/no-loss-matrix.ts`. Add the route with a `door`/reason string that reflects which canonical door it uses (mirror the nearest sibling route), then re-run.
