# SageOx fork ledger (PAN-2444, PAN-4852)

Overdeck runs SageOx from the operator's fork `eltmon/ox`, never from upstream
`sageox/ox` directly. This file records the fork branches, the host contract the
fork implements, and every change made on the fork for
[PAN-2444](https://github.com/eltmon/overdeck/issues/2444) (PRD
`.pan/drafts/pan-2444.md`) and the rebase onto upstream `v0.25.0` for
[PAN-4852](https://github.com/eltmon/overdeck/issues/4852) (PRD
`.pan/drafts/PAN-4852.md`).

No agent contacts upstream. Upstreaming any of this is the operator's call.

## Branches

| Branch | Commit | Notes |
|---|---|---|
| fork `main` (before this work) | `cf00e2123875efe7b0a8e6a729f818eb50fe4ac9` | Recorded with `git ls-remote origin main` before any push. Left untouched: no force push, no rewrite. |
| `overdeck-base` | `201c0a56650d5a698c391aafca815a8371adbe04` | Upstream tag `v0.19.0^{commit}` ("release: prep v0.19.0 (#1085)", 2026-09-28). Fork PRs target this branch. |
| `overdeck/host-managed` | cut from `overdeck-base` | Work branch for the host-managed mode. Each fork item adds commits here; see "Changes". |
| Fork PR | [eltmon/ox#1](https://github.com/eltmon/ox/pull/1) | `overdeck/host-managed` → `overdeck-base`, head `de597179542aca4a4815e0b6ab49f75809fa3be7`. Superseded by the `-v0.25.0` branches below (PAN-4852); kept as history. |
| `overdeck-base-v0.25.0` | `29bb474454bbc1a9cfcb597b64e97388313fae15` | Upstream tag `v0.25.0^{commit}` ("release: prep v0.25.0 (#1625)", 2026-10-28). Added by PAN-4852 F7; the old `overdeck-base` keeps its commit. |
| `overdeck/host-managed-v0.25.0` | `0e6c7e2df8fd89638a2d40db08cc45d4cff05fdc` | The F2-F6 commits rebased onto `overdeck-base-v0.25.0`, plus F8. This head is the commit the `sageox` pack trusts and Overdeck builds `ox` from. The old `overdeck/host-managed` keeps its commit. No PR was opened for it. |

Fork clone used by the work agent: `$HOME/Projects/ox-pan-2444` (remote `origin` =
`git@github.com:eltmon/ox.git`; remote `upstream` = `https://github.com/sageox/ox.git`,
fetch only, its push URL is set to `DISABLED`).

## Contract

The fork adds a **host-managed mode**. It is additive and env-gated: with
`OX_HOST_MANAGED` unset, the fork behaves exactly like the upstream tag its base branch points at (`v0.25.0` for `overdeck-base-v0.25.0`)
(NFR-4). Overdeck sets these variables for every Claude Code launch where the
`sageox` pack is active.

| Env var | Values | Meaning |
|---|---|---|
| `OX_HOST_MANAGED` | `1`, `true`, `yes`, `on` (case-insensitive) | The host (Overdeck) supplies hooks and env at launch. `ox` writes nothing into the repo and adds no attribution. |
| `OX_HOST_NETWORK` | `on` \| `off` | Host network gate. Under host-managed mode an unset or unknown value means `off`. `off` means `ox` makes no network calls. |
| `OX_PROJECT_ROOT` | absolute path | Existing upstream override of project-root discovery. Overdeck sets it to the launch's git root. |
| `OX_SESSION_PUBLISHING` | `manual` \| `auto` | Existing upstream override. Overdeck sets `manual` when uploads are off, `auto` when on. |
| `SAGEOX_TELEMETRY=false`, `SAGEOX_FRICTION=false`, `SAGEOX_DAEMON=false`, `OX_NO_DAEMON=1` | fixed | Existing upstream switches. Overdeck always sets them. |

Probe command and sample output (fork build at `de59717`):

```bash
$ OX_HOST_MANAGED=1 OX_HOST_NETWORK=off ox host-contract --json
{
  "contract": "overdeck-host/1",
  "hostManaged": true,
  "version": "0.19.0",
  "commit": "de597179542aca4a4815e0b6ab49f75809fa3be7"
}
```

Upstream `ox` exits 1 with `unknown command "host-contract"`, which Overdeck reads as "no host contract".

Requirements the fork meets under `OX_HOST_MANAGED=1` (PRD §5):

- **FR-10** No repo writes by `ox agent prime`, `ox agent hook`, or the daemon: no `ox:prime` marker edits in AGENTS.md/CLAUDE.md, no `.claude/settings.json` or `.codex/hooks.json` writes, no `ox-cli-*` skill inventory writes.
- **FR-11** No attribution: prime output has no attribution guidance and no plan footer, and the commit/PR/session attribution values resolve to empty.
- **FR-12** With `OX_HOST_NETWORK` not `on`: session publishing resolves to `manual` regardless of config and env; telemetry, friction, GitHub sync, cloud query and OpenTelemetry export are off; no daemon starts; a process-wide network guard replaces `http.DefaultTransport` with a transport that refuses every request. Explicit transports are gated or shown loopback-only. With publishing manual and the daemon off, no ledger git push or pull starts.
- **FR-13** `ox host-contract --json` prints `{"contract":"overdeck-host/1","hostManaged":true,"version":"<ox version>","commit":"<vcs.revision or empty>"}` and exits 0. Upstream `ox` has no such command, so the probe fails there and Overdeck fails closed.
- **FR-14** When `.sageox/` is missing, `ox agent prime` and `ox agent hook` exit 0 and print nothing to stdout, and the "Not logged in. Run 'ox login'" text never reaches the agent's context.
- **FR-15** `OX_HOST_MANAGED=1 ox init` writes only `.sageox/` (registration needs `OX_HOST_NETWORK=on`): no AGENTS.md/CLAUDE.md markers, no Claude/Codex hook files, no git hooks.

## Audit of old fork commits

The three commits on the fork's old `main` (Feb 2026, PAN-277 era, based on
`ox` v0.2.x) were checked against `overdeck-base` (`v0.19.0`). None is carried
forward; all three stay on the fork's `main` as history.

- `70e0f37a37` (OX_PROJECT_ROOT, `--project`, `--auto-record`, `--issue`, `--title`, `--parent-session`, `ExternalIssueID`) — **superseded upstream, not carried.** `OX_PROJECT_ROOT` exists upstream as `config.EnvProjectRoot` (`internal/config/env.go`) with the single resolver `ResolveProjectRootOverride()` (`internal/config/project_config.go`), used by both `config.FindProjectRoot()` and `cmd/ox/agent.go` `findProjectRoot()`, so the `--project` flag is not needed. `--auto-record` is covered by the upstream recording modes (`OX_SESSION_RECORDING=auto`, `internal/config/session_recording.go`). Parent/subagent linking exists upstream as `RecordingState.ParentSessionPath`/`ParentAgentID` plus `Origin == "subagent"` (`internal/session/recording.go`), and `Title` exists on `RecordingState`. `ExternalIssueID`/`--issue` has no upstream equivalent and is dropped on purpose: PRD D3 says Overdeck stores no `ox` session identity.
- `acdf05c9d0` (update the `startSessionRecording` call site in `agent_hook.go`) — **obsolete, not carried.** It only adapted a call site to the extra parameters added by `70e0f37a37`. Upstream's hook path is now `startSessionRecordingIfConfigured` (`cmd/ox/agent_hook.go`) with its own signature.
- `cf00e21238` (`.github/workflows/fork-release.yml`, publishes a rolling `latest` pre-release of binaries on every push to fork `main`) — **not carried.** PRD D12 has the operator build `ox` from the pinned fork commit with `go build`; `pan install` never downloads `ox`. A rolling `latest` binary would also defeat the commit match that `pan doctor` reports against the `sageox` pack's trusted commit. Upstream's own `release.yml` is gated to `github.repository == 'sageox/ox'` and never runs on the fork.

## Changes

Commits on `overdeck/host-managed` (F1-F6) and on
`overdeck/host-managed-v0.25.0` (F7, F8), newest last. Each fork item appends
its entry here. The F2-F6 hashes below are the original `v0.19.0` commits; F7
lists their rebased hashes.

- **F1 `fork-base`** — created `overdeck-base` at `v0.19.0` and cut `overdeck/host-managed` from it. No code changes.
- **F2 `fork-no-repo-writes`** — commit `3e3012ba5d4095180c5997577d8475b88f819f59`. Adds `internal/config/host.go` (`EnvHostManaged`, `HostManaged()`: true for `1|true|yes|on`, case-insensitive). Under host-managed mode, `ox agent prime` skips `EnsureOxPrimeMarker`, `ensureClaudeHooks` and `reconcileSkillInventoryIfStale`; it exits 0 with empty stdout when no `.sageox/` is found; and the logged-out (degraded) message is only "Session recording is active locally." with no `ox login` text. The daemon's team skill/rule convergence (`internal/teamconverge/handlers.go`) settles every artifact as unsupported, and the autofix scheduler (`internal/daemon/daemon.go`) does not start. `ox agent hook` already returned silently in an uninitialized repo; its start phase runs prime as a subprocess, which inherits the env and so the prime gates. Tests: `internal/config/host_test.go`; `cmd/ox/host_managed_test.go` (prime and five hook events leave `git status --porcelain` empty in an initialized repo whose markers and `.claude/` were stripped; uninitialized prime/hook print nothing; logged-out JSON prime has no `ox login`), each with an upstream control proving the assertion is not vacuous. Under `go test` the hook's prime subprocess is skipped by `selfexec`, so the hook test covers the in-process hook handlers only. Verified: `go test ./cmd/ox/... ./internal/config/... ./internal/daemon/... ./internal/teamconverge/...` all pass.
- **F3 `fork-network-gate`** — commit `91c3ca53c162232f5cfeeed9d320a0c2330aaf0c`. Adds `EnvHostNetwork` (`OX_HOST_NETWORK`), `HostNetworkAllowed()` (true only for `on`, case-insensitive), `HostOffline()` (= host-managed and network not allowed), `ErrHostNetworkOff` and `InstallHostNetworkGuard()` to `internal/config/host.go`. Offline: `ResolveSessionPublishing` returns `manual` with new source `host` before reading env or config; `ResolveGitHubSync` (and so the PR/issue variants) returns `disabled`; `ResolveUserPromptSubmitCloudQuery` returns false (so `PrepareCloudQuery` never queries); `telemetry.Enabled()`, the daemon's `isTelemetryEnabled`/`isFrictionEnabled` and the CLI friction path are off; `daemon.IsDaemonDisabled()` is true; `observability.Init` returns before creating an exporter. `main()` calls `InstallHostNetworkGuard()` as its first statement (before the detached telemetry sender branch), replacing `http.DefaultTransport` with a transport that refuses every request. Explicit transports: `internal/trace/process.go` `localClient` only dials `127.0.0.1` (the local trace receiver), and `internal/observability/otel.go` is skipped offline. Tests: `internal/config/host_test.go` (gate table; the guard refuses a request to a live `httptest` server, which sees 0 hits, and restores; no-op unless offline; publishing/GitHub sync/cloud query resolution), `internal/telemetry/host_test.go`, `internal/daemon/host_test.go`, and `cmd/ox/host_network_test.go` (logged in, `SAGEOX_ENDPOINT` = an `httptest` server, `OX_SESSION_PUBLISHING=auto`: prime and hooks SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd send the server 0 requests, and a session `raw.jsonl` lands in the ledger cache). **Test limit:** in this harness upstream's network work for the lifecycle is daemon-driven or asynchronous, so even with the network on the lifecycle sends the test server no request; a network-on control was therefore not sensitive and is not included. The guard's direct refusal (unit test, and an in-process `http.Get` in the E2E) is the load-bearing evidence. Verified: `go test ./cmd/ox/... ./internal/config/... ./internal/telemetry/... ./internal/observability/... ./internal/daemon/... ./internal/cli/...` all pass.
- **F4 `fork-no-attribution`** — commit `52b8d669a1a35b25e14af877ecd161ea78c96567`. Under host-managed mode `loadResolvedAttribution()` returns an empty `ResolvedAttribution` (every string empty, threshold 0), so `ox pr header`, session notify/draft, plan collaboration and session status see attribution as off. Prime skips `withAttributionGuidance` (which also drops its "Not Logged In" note) and sets no plan footer; a new `prime.Output.HostManaged` field (`host_managed`, omitted when false) makes the XML renderer skip the `<attribution>` block. Tests in `cmd/ox/host_managed_test.go`: XML and JSON prime contain none of `Co-Authored-By`, `Guided by SageOx`, `<attribution>`, `SageOx Attribution`, `Attribution is`, with an upstream control that contains them. Verified: `go test ./cmd/ox/... ./internal/prime/... ./internal/config/...` pass.
- **F5 `fork-host-contract`** — commit `d97761ea7252325e9101a22b74993c21a64c2307`. New hidden command `ox host-contract [--json]` (`cmd/ox/host_contract.go`, self-registered in `init()`, absent from `ox --help`). JSON: `{"contract":"overdeck-host/1","hostManaged":true,"version":"<version.Version>","commit":"<vcs.revision from runtime/debug.ReadBuildInfo, or empty>"}`; `hostManaged` means the binary supports host-managed mode. Text mode prints `overdeck-host/1 (ox <version>, commit <sha|unknown>)`. Tests: `cmd/ox/host_contract_test.go` (exactly the four keys, values, text output, hidden). Verified: `bin/ox host-contract --json | jq -e '.contract=="overdeck-host/1"'` prints `true` (0.09 s); `go test ./cmd/ox/...` passes. Note: run without `OX_HOST_MANAGED`, any `ox` command (this one included) still sets up upstream's OpenTelemetry exporter and may log to stderr, so Overdeck's probe sets `OX_HOST_MANAGED=1` to keep it offline.
- **F6 `fork-init-host-managed`** — commit `de597179542aca4a4815e0b6ab49f75809fa3be7`. Under host-managed mode `ox init` (`cmd/ox/init.go`) skips the whole AI coworker integration section (`selectAgentsForInit`, `injectOxPrime`, `EnsureInstructionFileMarkers`, `installAgentHooks` with its Claude/OpenCode/adapter hooks, git hooks and skill inventory reconcile, `EnsureScopedIgnoreFilesForDirs`), the root `.gitignore` legacy cleanup and `.gitattributes`, and prints that integration is left to the host. It still creates `.sageox/`, registers the repo with the API (which needs `OX_HOST_NETWORK=on`), and starts the daemon that clones the ledger. Tests in `cmd/ox/host_managed_test.go`: host-managed init with Claude Code selected changes only `.sageox/` paths (`git status --porcelain --untracked-files=all`) and adds no `.git/hooks` entries; the upstream control writes outside `.sageox/`. Verified: `go test ./cmd/ox/... ./internal/config/...` pass, and then the whole fork suite `go test ./... -count=1` passed (141 packages ok, exit 0) at this commit.
- **Fork PR** — [eltmon/ox#1](https://github.com/eltmon/ox/pull/1) "Host-managed mode for Overdeck", `overdeck/host-managed` → `overdeck-base`, head `de597179542aca4a4815e0b6ab49f75809fa3be7`. This is the commit the `sageox` pack should trust and `ox` should be built from.

- **F7 `fork-rebase`** (PAN-4852) — created `overdeck-base-v0.25.0` at upstream tag `v0.25.0` (`29bb474454bbc1a9cfcb597b64e97388313fae15`) and rebased F2-F6 onto it as `overdeck/host-managed-v0.25.0` (`git rebase --onto overdeck-base-v0.25.0 origin/overdeck-base`). This takes in 271 upstream commits (`v0.19.0..v0.25.0`); upstream `main` is ahead of the tag and was not taken. No commit was dropped and no upstream test was edited. Rebased hashes: F2 `4d626767`, F3 `eabc65cb`, F4 `13d45116`, F5 `275c2401`, F6 `90ab7673`. Conflicts and how they were resolved:
  - `cmd/ox/agent_prime.go` (F2): upstream now resolves the project root before the attribution load (and earlier still for Cursor). `hostManaged` is read once near the top, and both `findProjectRoot` failures return nil under host-managed mode. The logged-out message keeps upstream's new `CurrentUserKind` field with the host-managed message. Upstream's skill reconcile now also returns withheld team skills; the whole reconcile, including that list, stays skipped under host-managed mode.
  - `internal/daemon/daemon.go` (F2): upstream moved the autofix scheduler into `startAutofix()`; the host-managed gate moved into that function's early return.
  - `cmd/ox/main.go` (F3): import list only (upstream added `errkind`). `InstallHostNetworkGuard()` stays the first statement of `main()`, before upstream's new detached PostHog sender branch. That sender is reached only through `telemetry.Enabled()`, which F3 already turns off offline.
  - `cmd/ox/agent_prime.go`, `cmd/ox/agent_prime_xml.go`, `internal/prime/types.go` (F4): upstream renamed `loadResolvedAttribution()` to `loadResolvedAttributionFor(projectRoot)`; the host-managed empty result moved there and the F4 test calls it with the test repo root. The `<attribution>` block (which gained a moment-of-use reporting paragraph upstream) is wrapped whole in `if !output.HostManaged`. `Output.HostManaged` was re-added next to `PlanFooter`.
  - `cmd/ox/init.go` (F6): upstream's integration section gained `ensureUsagePane` and absolute hook paths; the section was re-wrapped whole in the host-managed `else`, and the root `.gitignore` cleanup and `.gitattributes` gates were re-applied.
  - Codex: `codexHookEvents` in `cmd/ox-adapter-codex/hooks.go` is unchanged at `v0.25.0` (`SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionEnd`). The only writers of `.codex/hooks.json` are `ox init` (gated by F6) and the explicit `ox integrate install` / `ox hooks install` commands; prime, hook and the daemon do not write it. No new Codex gate was needed.
  - Toolchain: `go.mod` at `v0.25.0` says `go 1.26.0` and `toolchain go1.27.3`, so `GOTOOLCHAIN=auto` now downloads Go 1.27.3.
  - Tests: `go test ./... -count=1 -timeout 60m` at `0e6c7e2d` (Go 1.27.3, git 2.43.0) exited 1: 161 packages ok, 22 with no test files, and one failing test, `TestPullTeamContext_LookAlikeDiscussions_NoFalseRenameConflict` in `internal/daemon` ("unresolved conflict in discussions/new/metadata.json requires manual resolution"). That test fails identically on unmodified upstream `v0.25.0` (`29bb4744`) on this machine, so the rebase did not cause it. Upstream added it in `v0.24.0` with fix #1394 (`3355911f`), which runs team-context pulls with `-c merge.renames=false -c diff.renames=false`; why git 2.43.0 still reports the rename conflict was not determined. Every `v0.24.x` tag carries the test, and only `v0.23.0` lacks it, by lacking that fix, so the AD-2 fallback (which applies to failures the rebase causes) was not taken and no test was edited. **`fork-rebase.ac2` ("`go test ./... -count=1` exits 0") is therefore not met literally.** The operator accepted the rebase with this failure recorded on 2026-11-02. The failing path is the `ox` daemon's team-context sync, which never starts in offline host-managed mode; with uploads on, the edge case stops team-context sync with a manual-resolution conflict (local changes kept) until upstream or a newer git fixes it. `cmd/ox` alone takes about 13 minutes, past Go's default 10-minute test timeout, so the suite needs `-timeout 60m`; under machine load `internal/daemon` took 72 minutes (268 s on an idle run).
- **F8 `fork-offline-plan-push`** (PAN-4852) — commit `0e6c7e2df8fd89638a2d40db08cc45d4cff05fdc`. Upstream (after `v0.19.0`) made every `ox agent prime` start a detached `ox plan flush-pending`, which retries plan commits with a Ledger `git push`. The HTTP guard cannot refuse a git subprocess, so under host-managed mode with the network off `kickPendingPlanPushes` (`cmd/ox/plan_push_pending.go`) now returns before starting it, and the pending markers stay for a later prime with the network on. This keeps F3's promise that offline host-managed `ox` starts no Ledger push. Test: `TestHostOffline_PrimeStartsNoPlanPushRetry` in `cmd/ox/host_network_test.go` (offline: no retry and the entry survives; network-on control: the retry is attempted). It fails with the gate removed.

### CP-1 outcome (offline recording)

Primary branch taken, no fallback. Under `OX_HOST_MANAGED=1` with the network off, recording is fully local: prime starts the recording and writes `<ledger>/.sageox/cache/sessions/<name>/raw.jsonl`, and no request is sent. **Precondition:** recording needs a local clone of the project's ledger (`ledger.Exists`). Only the ox daemon's sync scheduler clones it, which needs the network, and the daemon never runs in offline host-managed mode. Without a clone, prime reports `ledger_needed` and records nothing (it still sends nothing). So the operator's one-time setup must let the daemon clone the ledger once with the network on: `OX_HOST_MANAGED=1 OX_HOST_NETWORK=on ox init` starts the daemon, which clones it; `ox status` shows when it is there. Since PAN-4852, `pan skills pack sageox link` runs that `ox init` in a throwaway worktree and waits up to 120 s for the clone. `OX_SESSION_RECORDING` is not forced to `disabled`.

## Building

Overdeck builds `ox` itself. `pan skills pack add sageox` pins the trusted
commit, shows a consent preview, and builds `ox`, `ox-adapter-claude-code` and
`ox-adapter-codex` into `~/.overdeck/packs/sageox/<commit>/bin/`, with Go's
caches under `~/.overdeck/packs/sageox/go/`. `pan skills pack update sageox`
builds the new commit when the ref moves, and `pan skills pack sync sageox`
builds the trusted commit when its build is missing. Launches, hooks and
`pan doctor` use that binary by absolute path, never an `ox` on `PATH`.
Nothing is written to `~/.local/bin`.

The manual build below is for fork development only. `go.mod` requires
`go 1.26.0` with `toolchain go1.27.3`; with the default `GOTOOLCHAIN=auto`, an
older local Go downloads Go 1.27.3 automatically.

```bash
git clone git@github.com:eltmon/ox.git ~/Projects/ox-pan-2444   # once
cd ~/Projects/ox-pan-2444
git switch overdeck/host-managed-v0.25.0    # or check out the commit the sageox pack trusts
go build -o bin/ox ./cmd/ox
./bin/ox host-contract --json       # prints contract "overdeck-host/1"
```

Run the fork tests with `go test ./...` (or the package list named in each
change entry). With `OX_HOST_MANAGED` unset, the existing suite must pass
unchanged.
