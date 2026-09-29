# SageOx fork ledger (PAN-2444)

Overdeck runs SageOx from the operator's fork `eltmon/ox`, never from upstream
`sageox/ox` directly. This file records the fork branches, the host contract the
fork implements, and every change made on the fork for
[PAN-2444](https://github.com/eltmon/overdeck/issues/2444). The PRD is
`.pan/drafts/pan-2444.md`.

No agent contacts upstream. Upstreaming any of this is the operator's call.

## Branches

| Branch | Commit | Notes |
|---|---|---|
| fork `main` (before this work) | `cf00e2123875efe7b0a8e6a729f818eb50fe4ac9` | Recorded with `git ls-remote origin main` before any push. Left untouched: no force push, no rewrite. |
| `overdeck-base` | `201c0a56650d5a698c391aafca815a8371adbe04` | Upstream tag `v0.19.0^{commit}` ("release: prep v0.19.0 (#1085)", 2026-09-28). Fork PRs target this branch. |
| `overdeck/host-managed` | cut from `overdeck-base` | Work branch for the host-managed mode. Each fork item adds commits here; see "Changes". |

Fork clone used by the work agent: `$HOME/Projects/ox-pan-2444` (remote `origin` =
`git@github.com:eltmon/ox.git`; remote `upstream` = `https://github.com/sageox/ox.git`,
fetch only, its push URL is set to `DISABLED`).

## Contract

The fork adds a **host-managed mode**. It is additive and env-gated: with
`OX_HOST_MANAGED` unset, the fork behaves exactly like upstream `v0.19.0`
(NFR-4). Overdeck sets these variables for every Claude Code launch where the
`sageox` pack is active.

| Env var | Values | Meaning |
|---|---|---|
| `OX_HOST_MANAGED` | `1`, `true`, `yes`, `on` (case-insensitive) | The host (Overdeck) supplies hooks and env at launch. `ox` writes nothing into the repo and adds no attribution. |
| `OX_HOST_NETWORK` | `on` \| `off` | Host network gate. Under host-managed mode an unset or unknown value means `off`. `off` means `ox` makes no network calls. |
| `OX_PROJECT_ROOT` | absolute path | Existing upstream override of project-root discovery. Overdeck sets it to the launch's git root. |
| `OX_SESSION_PUBLISHING` | `manual` \| `auto` | Existing upstream override. Overdeck sets `manual` when uploads are off, `auto` when on. |
| `SAGEOX_TELEMETRY=false`, `SAGEOX_FRICTION=false`, `SAGEOX_DAEMON=false`, `OX_NO_DAEMON=1` | fixed | Existing upstream switches. Overdeck always sets them. |

Requirements the fork meets under `OX_HOST_MANAGED=1` (PRD §5):

- **FR-10** No repo writes by `ox agent prime`, `ox agent hook`, or the daemon: no `ox:prime` marker edits in AGENTS.md/CLAUDE.md, no `.claude/settings.json` or `.codex/hooks.json` writes, no `ox-cli-*` skill inventory writes.
- **FR-11** No attribution: prime output has no attribution guidance and no plan footer, and the commit/PR/session attribution values resolve to empty.
- **FR-12** With `OX_HOST_NETWORK` not `on`: session publishing resolves to `manual` regardless of config and env; telemetry, friction, GitHub sync, cloud query and OpenTelemetry export are off; no daemon starts; a process-wide network guard replaces `http.DefaultTransport` with a transport that refuses every request. Explicit transports are gated or shown loopback-only. With publishing manual and the daemon off, no ledger git push or pull starts.
- **FR-13** `ox host-contract --json` prints `{"contract":"overdeck-host/1","hostManaged":true,"version":"<ox version>","commit":"<vcs.revision or empty>"}` and exits 0. Upstream `ox` has no such command, so the probe fails there and Overdeck fails closed.
- **FR-14** When `.sageox/` is missing, `ox agent prime` and `ox agent hook` exit 0 and print nothing to stdout, and the "Not logged in. Run 'ox login'" text never reaches the agent's context.
- **FR-15** `OX_HOST_MANAGED=1 ox init` writes only `.sageox/`: no AGENTS.md/CLAUDE.md markers, no Claude/Codex hook files, no git hooks.

## Audit of old fork commits

The three commits on the fork's old `main` (Feb 2026, PAN-277 era, based on
`ox` v0.2.x) were checked against `overdeck-base` (`v0.19.0`). None is carried
forward; all three stay on the fork's `main` as history.

- `70e0f37a37` (OX_PROJECT_ROOT, `--project`, `--auto-record`, `--issue`, `--title`, `--parent-session`, `ExternalIssueID`) — **superseded upstream, not carried.** `OX_PROJECT_ROOT` exists upstream as `config.EnvProjectRoot` (`internal/config/env.go`) with the single resolver `ResolveProjectRootOverride()` (`internal/config/project_config.go`), used by both `config.FindProjectRoot()` and `cmd/ox/agent.go` `findProjectRoot()`, so the `--project` flag is not needed. `--auto-record` is covered by the upstream recording modes (`OX_SESSION_RECORDING=auto`, `internal/config/session_recording.go`). Parent/subagent linking exists upstream as `RecordingState.ParentSessionPath`/`ParentAgentID` plus `Origin == "subagent"` (`internal/session/recording.go`), and `Title` exists on `RecordingState`. `ExternalIssueID`/`--issue` has no upstream equivalent and is dropped on purpose: PRD D3 says Overdeck stores no `ox` session identity.
- `acdf05c9d0` (update the `startSessionRecording` call site in `agent_hook.go`) — **obsolete, not carried.** It only adapted a call site to the extra parameters added by `70e0f37a37`. Upstream's hook path is now `startSessionRecordingIfConfigured` (`cmd/ox/agent_hook.go`) with its own signature.
- `cf00e21238` (`.github/workflows/fork-release.yml`, publishes a rolling `latest` pre-release of binaries on every push to fork `main`) — **not carried.** PRD D12 has the operator build `ox` from the pinned fork commit with `go build`; `pan install` never downloads `ox`. A rolling `latest` binary would also defeat the commit match that `pan doctor` reports against the `sageox` pack's trusted commit. Upstream's own `release.yml` is gated to `github.repository == 'sageox/ox'` and never runs on the fork.

## Changes

Commits on `overdeck/host-managed`, newest last. Each fork item appends its
entry here.

- **F1 `fork-base`** — created `overdeck-base` at `v0.19.0` and cut `overdeck/host-managed` from it. No code changes.
- **F2 `fork-no-repo-writes`** — commit `3e3012ba5d4095180c5997577d8475b88f819f59`. Adds `internal/config/host.go` (`EnvHostManaged`, `HostManaged()`: true for `1|true|yes|on`, case-insensitive). Under host-managed mode, `ox agent prime` skips `EnsureOxPrimeMarker`, `ensureClaudeHooks` and `reconcileSkillInventoryIfStale`; it exits 0 with empty stdout when no `.sageox/` is found; and the logged-out (degraded) message is only "Session recording is active locally." with no `ox login` text. The daemon's team skill/rule convergence (`internal/teamconverge/handlers.go`) settles every artifact as unsupported, and the autofix scheduler (`internal/daemon/daemon.go`) does not start. `ox agent hook` already returned silently in an uninitialized repo; its start phase runs prime as a subprocess, which inherits the env and so the prime gates. Tests: `internal/config/host_test.go`; `cmd/ox/host_managed_test.go` (prime and five hook events leave `git status --porcelain` empty in an initialized repo whose markers and `.claude/` were stripped; uninitialized prime/hook print nothing; logged-out JSON prime has no `ox login`), each with an upstream control proving the assertion is not vacuous. Under `go test` the hook's prime subprocess is skipped by `selfexec`, so the hook test covers the in-process hook handlers only. Verified: `go test ./cmd/ox/... ./internal/config/... ./internal/daemon/... ./internal/teamconverge/...` all pass.

## Building

Build from the fork clone. `go.mod` requires `go 1.26`; with the default
`GOTOOLCHAIN=auto`, an older local Go downloads 1.26 automatically.

```bash
git clone git@github.com:eltmon/ox.git ~/Projects/ox-pan-2444   # once
cd ~/Projects/ox-pan-2444
git switch overdeck/host-managed    # or check out the commit the sageox pack trusts
go build -o bin/ox ./cmd/ox
./bin/ox host-contract --json       # after F5: prints contract "overdeck-host/1"
```

To make it the `ox` Overdeck sees, build to a directory on `PATH`
(for example `go build -o ~/.local/bin/ox ./cmd/ox`). The work agent never
overwrites `~/.local/bin/ox`; it builds only to `bin/ox` in the fork clone.

Run the fork tests with `go test ./...` (or the package list named in each
change entry). With `OX_HOST_MANAGED` unset, the existing suite must pass
unchanged.
