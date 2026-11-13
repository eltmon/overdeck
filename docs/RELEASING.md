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

## Update the public changelog

The public changelog is [`changelog.mdx`](../changelog.mdx) at the repo root, served by the Mintlify docs site at `/changelog` (the `Changelog` tab in `docs.json`). Each PR that changes something users notice adds its own entry file under [`changelog.d/`](../changelog.d/README.md) (format: `changelog.d/README.md`) instead of editing `changelog.mdx` directly, so two PRs in flight never conflict on the same lines.

On release day:

1. List the pending entries: `ls changelog.d`. Open each one and fix any wording you want to change, in a normal commit, before releasing. Write every currency dollar as `&#36;` (for example `&#36;2/M input`) and every `<` before a digit as `&lt;`: Mintlify renders paired `$` as math (even escaped as `\$` on a line that also has inline code), and strict MDX rejects a bare `<` before a digit. `npm run lint:docs` (part of `npm run lint` and CI) checks every entry file for both and fails on either.
2. Run `pan release stable --version X.Y.Z`. It folds the pending entries into one `<Update label="vX.Y.Z" description="YYYY-MM-DD">` block at the top of `changelog.mdx`, with sections in the order New, Improved, Fixed, and a compare link from the previous block's label to the new tag, then deletes the folded entry files in the release commit. It refuses to proceed, before the minutes-long preflight runs, on a malformed entry, a misnamed file in `changelog.d/`, or a leftover Upcoming/Unreleased block: move that block's bullets into entry files first. `pan release canary` never folds; `changelog.d/` and `changelog.mdx` are its own concern only on `stable`. On a retag whose `vX.Y.Z` block already exists in `changelog.mdx`, it leaves the entry files in place for the next release. With no entry files, `changelog.mdx` is unchanged and the release still proceeds.
3. Push `main` and the tag. Mintlify redeploys from `main`.

## Adding a model that needs a newer Claude Code

New Claude models sometimes require a newer Claude Code CLI than operators
already have installed. When adding one:

1. Set `minClaudeCodeVersion` on the model's capability row in
   [`src/lib/model-capability-additions.ts`](../src/lib/model-capability-additions.ts)
   — the oldest Claude Code CLI (`X.Y.Z`) that recognizes the model. Leave it
   unset for a model with no documented requirement.
2. Add the model and its minimum to the table in
   [`configuration/harnesses.mdx`](../configuration/harnesses.mdx) under
   "Claude Code version requirements".
3. State the requirement in the model's changelog entry so operators upgrading
   Overdeck see it before the model fails to launch.

The launch gate (`prepareHarnessLaunch`, PAN-4359) reads `minClaudeCodeVersion`
directly — no other wiring is needed for the refusal or the dashboard banner
to pick up a new minimum.

## Verify a clean install

After npm lists the new version, run the advertised launch command with an empty cache and an empty global prefix. A global `@overdeck/core` on the release machine otherwise satisfies `npx` and hides a broken package:

```bash
T=$(mktemp -d); cd "$T"
npm_config_prefix="$T/prefix" npx --yes --cache "$T/cache" @overdeck/core@X.Y.Z --version
```

It must print `X.Y.Z`. v0.60.0–v0.62.0 failed this check with `Cannot read properties of null (reading 'edgesOut')`, because the runtime `dependencies` listed the test library `@effect/vitest`. If the check fails, ship a patch release the same day.

## Workflow behavior

The GitHub release workflow distinguishes stable vs canary tags.

### Stable tags

For tags like `v0.7.1` the workflow will:
- install dependencies and build the project
- upload the dashboard sourcemaps to PostHog
- run the full test suite and smoke-test the CLI
- pack `@overdeck/core` into one tarball (job `pack`)
- install that exact tarball on a bare macOS host and run the bare-host smoke (job `bare-host-macos`)
- publish that tarball to npm `latest`, then build and publish `@overdeck/contracts` and `@overdeck/desktop` (job `npm`)
- build the Linux desktop app
- generate a structured release body from git history
- create a normal GitHub Release

### Canary tags

For tags like `v0.8.0-canary.1` the workflow runs the same steps, except that it publishes to npm with `--tag canary` and creates a GitHub prerelease.

If the macOS bare-host smoke fails, nothing is published and no GitHub Release is created. `npm` needs `bare-host-macos`, and the `release` job needs `npm`.

## Bare-host smoke (PAN-5176)

`scripts/bare-host-smoke.sh` installs `@overdeck/core` the way a user's machine gets it, on a host that has Node, git and the OS's own system directories, and none of `docker`, `tmux`, `systemctl`, `journalctl` or `brew` on `PATH`. CI runs it on every PR (`bare-host-linux`), on relevant PRs and every CI-triggering push to `main` (`bare-host-macos`), and the release runs it on the tarball it is about to publish.

It checks three things:

1. **`pan up --no-resume --no-open --detach`** exits 0, passes `/api/health`, and prints no line that shows it trying to install, or failing on, a tool the Herdr backend does not need.
2. **The idle dashboard** stays within its budget per 30 s window. On Linux the measure is new PIDs, net of a baseline window with no Overdeck process. On macOS it is the traced spawn cost: the `child_process` calls the dashboard makes, plus 5 for each call that fails to spawn, because macOS makes one try per `PATH` entry. A hosted macOS runner's own process churn moves the baseline by hundreds of PIDs per window, so the PID net is reported there but does not decide.
3. **No `spawn <tool> ENOENT` line repeats** in the logs.

Every child process runs under `env -i` with an isolated `HOME` and a fixed six-entry `PATH`: Node, Herdr, and the four system directories (on Linux, mirrors of them without the denied tools). The script never passes `CI`, so Herdr setup runs as it does on a user's host.

**Budgets.** `IDLE_BUDGET_MACOS=30` and `IDLE_BUDGET_LINUX=30`, set by the rule `max(10, min(30, 3 x highest sample))` and never above 30. Calibration on 2026-11-13: macOS traced cost 25 on six runs; Linux PID net 10, 5, 6 and 8 on four runs. The known-bad `@overdeck/core@0.81.0` scores a traced cost of 126 on the same macOS runner, and the `bare-host-macos-known-bad` CI job keeps checking that the smoke still fails it.

**Run it locally.** It refuses (exit 2) when any of ports 3010, 3011, 3012 or 8317 has a listener, because `pan up` and `pan down` stop whatever owns the dashboard ports. Stop your own dashboard first, then from the repo root:

```bash
mkdir -p .tmp/smoke && bash scripts/bare-host-smoke.sh --tarball ".tmp/smoke/$(npm pack --ignore-scripts --pack-destination .tmp/smoke | tail -1)" --work-dir "$PWD/.tmp/smoke/run1"
```

`--work-dir` must not exist or must be empty, and the script deletes nothing. A run on the Mac rig is optional; CI is the gate.

**Read `result.json`.** It is written to `--work-dir` (or `--out`) and uploaded as the job's logs artifact. `pass` is the verdict. `panUp.forbiddenToolLines` lists the offending `pan up` lines. `idle.rule` says which measure decided (`traced-cost` or `pid-net`), `idle.value` is the number compared with `idle.budget`, and `idle.spawns.top` names the programs the dashboard spawned in the idle window, with their failures. `setupError` is set when the run could not measure at all (exit 2). The script exits 0 on pass and 1 when a check failed.

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

### The release stopped at `bare-host-macos`

The macOS bare-host smoke failed on the tarball the release was about to publish, so nothing went to npm and no GitHub Release exists. Download the `bare-host-macos-release-logs` artifact from the run and read `result.json` (see "Bare-host smoke (PAN-5176)"): `panUp.forbiddenToolLines` for a `pan up` that needs a missing tool, `idle.spawns.top` for the program the idle dashboard spawns too often. Fix it on `main`, then cut the next version through `pan release stable`. Never publish by hand to get around the gate.

### `pan release check` fails tests on the no-loss matrix

A new HTTP route isn't registered in `tests/unit/lib/overdeck/no-loss-matrix.ts`. Add the route with a `door`/reason string that reflects which canonical door it uses (mirror the nearest sibling route), then re-run.
