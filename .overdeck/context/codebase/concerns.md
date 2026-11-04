# Concerns / hazards

Live landmines a change in this repo can step on. Verified 2026-09-26 (Fly, linked-machine pooling and feature-branch-push bullets 2026-11-01/02).

- **ToS policy gate** — `canUseHarness()` (`src/lib/harness-policy.ts`) blocks
  ohmypi/prime-agent + Anthropic + subscription auth (plus the model/harness pairing
  rules listed in its header). Every harness resolution path must end by passing its
  winner through this gate. In `resolveHarness` a denial throws `HarnessResolutionError`
  for an explicit pick or a non-claude-code provider default (PAN-1871); only an
  Anthropic-native model collapses to `claude-code`. Never bypass, never reorder around it.
- **Harness resolution is unified in `resolveHarness()`** (PAN-1787, landed
  3da6c9bc1) — `src/lib/harness-resolve.ts`. Precedence: explicit → roles[role].harness
  → providerHarnesses[provider] → built-in provider default → claude-code. Any value
  passed as `explicit` wins the whole chain, so spawn entry points must pass
  `undefined` (not a coalesced `'claude-code'`) when the user made no choice.
  PAN-1826 found `src/cli/commands/start.ts:709` doing `options.harness ?? 'claude-code'`
  (provider default silently bypassed on every flagless `pan start`) and the
  conversations route (`routes/conversations.ts:411 resolveAllowedHarness`) hard-defaulting
  claude-code without consulting the resolver.
- **Legacy `specialist_harnesses`** (PAN-636) — `model_selection.specialist_harnesses`
  in `src/lib/cloister/config.ts:157-163` + `router.ts getSpecialistHarness` is a
  deprecated alias at role-tier precedence (PAN-1787). Its only consumer,
  `specialists.ts buildSpecialistBaseCommand`, is dead code (no callers) — not a
  live spawn path.
- **Every agent launch path must stamp `startedBy`** — the token identifies the immediate operator or autonomous path and must survive `state.json`, the agents-table `started_by` column, detached `pan start` environment propagation, and planning-agent state. `flywheelRunId` exposed both failure modes: launch code resolved it without persisting it, and state cleanup later dropped it. Treat any new provenance field as a no-loss audit across both state stores and every spawn/resume entry point. Flywheel provenance is the `flywheel:` prefix on `startedBy` (the `conv-flywheel` shell mints `flywheel:conv-flywheel`); PAN-3634 moves the operator-started reaping exemption onto it because `flywheelRunId` was fed only by the dead `flywheel.active_run_id` setting.
- **JSONL resume across model/harness change** — `spawnMode: 'resume'`
  (`agents.ts:2647`, `resumeAgent` ~:4537) emits `--resume <sessionId>`
  (`launcher-generator.ts:427,529`). Resuming a session created under a different
  model/harness corrupts/loses context; PAN-1787 adds a guard (fresh session +
  continue.json re-onboarding instead). Compact recovery (PAN-1781) already
  forces fresh sessions — keep that behavior.
- **`postMergeLifecycle` idempotency** — guarded by
  `src/lib/cloister/in-flight-guard.ts` + its test. Weakening it reopens the
  PAN-328 infinite-loop (24k tracker calls). Keep the test green.
- **Polyrepo workspace roots have no `package.json`** (PAN-4929) — `createWorkspace`
  (`src/lib/workspace-manager/create.ts`) must never run a package manager in a directory
  without `package.json`: npm walks up to the nearest ancestor with `node_modules`, fails there,
  and writes a stray `package-lock.json` into that ancestor. Polyrepo per-repo deps belong to
  the repo's container or gates (`verification-runner.ts` skips polyrepo installs too); a
  host install in a repo is opt-in through `repos[].package_manager`.
- **Polyrepo UAT: never gate on `repos.length`** (PAN-3093) — every generation
  reads back with at least one `repos` entry because monorepo rows synthesize
  one, and a polyrepo project with a single contributing repo still needs the
  per-repo path. Gate on the injected per-repo deps instead (`polyrepoGit` in
  `uat-promote.ts`, `removeRepoArtifacts` in `uat-generation-engine.ts`).
- **UAT anchors are compared by string equality** (PAN-3093) — the reconciler
  decides staleness by comparing an anchor it computes now against what
  assembly stored, so both sides must build anchors with the shared helpers in
  `src/lib/cloister/uat-polyrepo-engine.ts`. Member anchors order by `repoKey`
  because `mergeOrderInRepo` is knowable only to assembly; ordering on it makes
  every generation read stale and reassemble forever.
- **Polyrepo promote is resumable, not transactional** — phase A trial-merges
  every repo before anything is pushed, but a phase-B failure leaves earlier
  repos landed on purpose. Recovery is retry-with-skip via `promoted_at`; never
  force-push or rewind a member repo's main (one-way door). A retry that finds
  every repo landed must FINALIZE, not error — that is the crash window between
  the last push and finalization.
- **Read-only member repos are never UAT targets** (PAN-3093) — `required ===
  false` (from `readonly: true`) is enforced in the ready set, in
  `buildPolyrepoGitDeps`/`buildPolyrepoCleanupGit`, and re-checked against
  current config at promote time. Assembly pushes branches, promote pushes
  merges, and cleanup deletes remote branches, so every one of those is a write
  boundary.
- **Feature contributions carry the LOGICAL branch** (`feature/<issue>`), never
  `origin/…` — `GenerationGitDeps` validates with `safeBranchName(…, 'feature')`
  and resolves origin-first itself. Passing a remote-qualified ref makes every
  merge throw and every feature get held out.
- **A ready-set branch probe must FETCH first** — `git rev-parse origin/<b>`
  reads a local tracking ref and never contacts the remote, so a branch pushed
  from another machine reads as absent and its project never assembles.
- **`promoted_at` is not proof of "not landed"** — publish and stamp are two
  writes to two systems. Promote must ask git (`findLandedMerge`) whether a
  nominally pending repo is already contained in its target before classifying
  it, or a crash between the two wedges the batch as stale-base forever.
- **Stale `node_modules/.experimental-vitest-cache`** (vitest `fsModuleCache:
  true`) serves PRE-FIX transforms: a fix appears not to work, and an inert
  comment "fixes" it. If a change seems to have no effect, purge that directory
  before debugging the code. It also masks unrelated failures.
- **Polyrepo assembly is feature-atomic** — a feature applies to all its repos
  or none, rolled back with `checkout -B` to a captured head. Do NOT reintroduce
  rebuild-and-replay: it is O(repos x features²) heavyweight git and can hold the
  project's single-flight reconcile slot for hours.
- **Single Deacon invariant** — never mount `~/.overdeck` into workspace
  containers; `OVERDECK_DISABLE_DEACON=1` belt-and-suspenders.
- **The Deacon freeze silences every deacon-lite routine** — `deacon.globally_paused`
  (overdeck.db `app_settings`, sidebar Snowflake toggle) makes `runDeaconLite()`
  return before any routine: no stuck nudges, stalled-review recovery,
  closed-issue reaping, or deferred hand-off retries. It persists across restarts
  and "Deacon-lite started" still logs. Check it first when a patrol "never ran"
  (PAN-4210). `CloisterService.isSpawnPaused()` / `cloister.spawns_paused` has no
  callers; that flag gates nothing.
- **`state.json` `status` is a spawn-time snapshot** — since PAN-3917,
  `saveAgentStateAndEmitEvent` (`dashboard/server/services/agent-projection.ts`)
  only appends an event, so complete-planning's "Marked planning-… as stopped"
  never reaches `state.json`. Never gate behavior on that label; use the live
  inventory (`liveness.ts` / `liveAgentInventory`) and `startedAt`/`stoppedAt`.
  Consequence: a dead agent stays in `listAgentStates({ status: 'running' })`
  forever, so any patrol that iterates it and emits per agent must dedupe per
  death — deacon-lite's `reconcileAgentLiveness` did not, and emitted ~50k
  events/day (PAN-4300).
  Close-out's DoD row 5 (`checkPostMergeRow`, `lifecycle/dod-gate.ts`) trusted
  the label and blocked every close-out on exited agents; PAN-4324 confirms
  claimed-live rows with `isAlive` (indeterminate still blocks).
- **Dashboard runtime** — Node 22 + built `dist/` only (node-pty native addon
  dies under Bun; circular ESM imports die under tsx/Node source mode).
- **`execSync` freezes the server** — anything reachable from the dashboard event
  loop must use async exec/spawn (PAN-70: ~70 calls cleaned up). Note doctor's
  `checkCommand` (`src/cli/commands/doctor.ts`) is execSync-based — CLI-only, do
  not import it into server-reachable code.
- **tmux sync primitives are legacy debt** — `capturePaneSync`/`killSessionSync` etc. exist but new
  callers must use async variants; raw `send-keys "text" C-m` drops Enter.
- **RTK output compression** — when `agents.rtk.enabled`, Bash output agents see
  may be compressed/garbled; trust exit codes over visual output.
- **Dead UI code** — `components/Settings/Provider/` (ProviderCard, ProviderPanel,
  ThinkingLevelSlider) is entirely unimported (references the Material Symbols
  font removed in a37f8c890). Slated for deletion in PAN-1787.
- **`pipeline.updatedAt` conflates write-recency with verdict-truth** (PAN-3092) —
  `projectPipeline()` (`src/lib/pan-dir/records.ts:109`) stamps it on EVERY status
  write, verdict or not, and every newer-wins comparison (`pickNewerPipeline`,
  the verdict-fallback drain's supersede check) inherits the conflation: a
  newer-but-verdict-free write makes the drain DELETE a fallback unlanded and
  makes `pickNewerPipeline` silently drop a verdict fold while reporting success.
  Any change touching record merges must stay verdict-aware (terminal verdicts
  survive same-cycle verdict-free writes; only a newer `reviewSpawnedAt` or a
  newer terminal verdict supersedes).
- **Leftover per-workspace `.venv` / `.tldr/`** from the removed TLDR feature
  (PAN-4429) can be 1.5–7.5GB each. Overdeck no longer creates or deletes them
  (they may be the user's own); `.gitignore` keeps them untracked. Don't copy or
  back up old workspaces blindly.
- **`remote.enabled` lives only in config.toml** — `loadConfig()` reads `[remote] enabled`
  from `~/.overdeck/config.toml` and overlays only `resiliency_tier` / `max_concurrent_agents`
  from config.yaml's `remote:` section; an `enabled` key in config.yaml is ignored. Any
  "remote is off" message must name config.toml and the line `enabled = true` under `[remote]`
  (PAN-4905). The live setup verb is `pan admin remote setup`, not `pan remote setup`.
- **Fly Machine rootfs resets on every start** — the rootfs is rebuilt from the
  image on stop/start and on `restart.on-failure`. The ephemeral tier mitigates this
  with a VM-side continuous commit+push heartbeat daemon plus per-bead push
  instructions; the durable tier mitigates it by mounting a persistent Fly volume at
  `/workspace`. Never run durable work without verifying the volume mount
  (PAN-1845). The three host loops for Fly agents (PAN-4295): the heartbeat and
  credential refresh run in `hygiene-scheduler.ts` (not behind the deacon freeze,
  or every ephemeral watchdog would stop its machine); the reap runs in
  `deacon-lite.ts` via `remote-reap-routine.ts` (behind the freeze). The reap acts
  only on positive evidence: a failed exec is `indeterminate`, never a crash.
  The deacon child inherits the dashboard's stdout, so its `[deacon-lite]` and
  `[hygiene-scheduler]` lines land in `~/.overdeck/logs/dashboard.log`, not
  `deacon.log`. Verified live on the deployed build by PAN-4696 (2026-11-02):
  the reap and heartbeat loops both fired automatically with no operator
  command (FR-1, FR-3 passed); PAN-4696's deployed-build check found
  [#4847](https://github.com/eltmon/overdeck/issues/4847) (automatic reap
  skips the review request when an unrelated process leaves a tracked
  workspace file dirty at hand-off).
- **Remote tmux helpers resolve their target from remote-state** — `getRemoteAgentOutput`,
  `sendToRemoteAgent(Keyed)`, `killRemoteAgent`, `isRemoteAgentRunning` and the reap's
  `probeRemoteSession` address `remoteTmuxTarget(agentId)`: a linked work agent's
  `conv-<name>` on the VM's `overdeck` socket (PAN-4734), else the legacy `agent-<issue>` on
  home's `getManagedTmuxSocketName()` (`overdeck-<hash>` on a non-default `OVERDECK_HOME`).
  New code that runs commands in an agent's VM session must use the target, never the agent
  id. Linked remote-state is also skipped by the spend cap's agent count, the remote heartbeat
  and the credential refresh (its Fly machine record covers the VM), and the Fly idle sweep
  never removes a machine hosting a `starting`/`running` linked agent. The legacy VM still
  disagrees with its prompt about the continue file: `createRemoteWorkspace` writes
  `/workspace/.pan/continue.json` but the REMOTE prompt names
  `<workspace>/.overdeck/continue.json`.
- **Fresh Claude Code state shows startup dialogs that eat the first message** — every
  Fly VM starts with an empty `~/.claude.json` (exec shell `HOME=/`). Each dialog
  Claude Code can show at launch must be pre-answered in
  `FlyProvider.configureClaudeCode` (onboarding, `/workspace` trust,
  `bypassPermissionsModeAccepted`, and since PAN-4738 `hasSeenAutoDefaultNudge`).
  Verify a key in the image's `claude.exe` (`grep -a`), never in a host config. A
  dialog's select cursor is the same `❯` the composer shows, and unnumbered selects
  escape `paneHasBlockingChoiceMenu`, so `waitForClaudeReady` matches known
  dialog titles instead.
  With no `FLY_API_TOKEN` (or `remote.fly.api_token_env` variable), `createFlyApiClient()`
  sends flyctl's stored `~/.fly/config.yml` token through a `FlyTokenSource`
  (`src/lib/remote/fly-token.ts`, PAN-4748): `FlyApiClient.request()` re-reads the token
  per call and, on a 401/403, runs `flyctl auth token` once (process-wide single-flight,
  60s cooldown on failure) and retries. `pollUntil` rethrows a rejection that survives
  the retry as `FlyMachineError('fly-token-rejected')` instead of counting it as "not
  finished"; the heartbeat/sweep/Codex-sync loop lines, `pan machines unlink`/rollback,
  and `pan doctor`'s `Fly token` row all report it as `Fly token rejected`.
- **A pooled channel agent must set `timeout`, or Node ignores the peer's keep-alive hint** —
  `http.Agent.keepSocketAlive` applies `Keep-Alive: timeout=N` only when it is below a nonzero
  agent `timeout`; with none, a free socket never expires. The other dashboard's stock HTTP
  server closes idle channels after 5 s, and behind the Fly WebSocket proxy home may not see
  that close, so `LinkAgent` (`src/lib/anywhere/link-client.ts`) reused a dead channel and the
  first `linkFetch` after idle failed with `socket hang up` (PAN-4740). `ChannelSocket`'s idle
  timer was one-shot, unlike `net.Socket`, which also defeats pool expiry after one mid-request
  timeout. Any new pooled agent over channels needs both an explicit `timeout` and re-arming
  socket timeouts.
- **A workspace's `feature/<id>` branch tracks `origin/main`** (`branch.<b>.merge =
  refs/heads/main`), so a bare `git push` from a workspace fails ("upstream branch
  does not match") and `pushPlanArtifacts` (`overdeck/plan-artifact-commit.ts`)
  would push to `main`. Push a feature branch with an explicit refspec
  (`git push origin HEAD:refs/heads/feature/<id>`) and never `-u`: `@{u}` readers
  (`workspaces/git-state.ts`, `xbrief/continue-state.ts`, `lanes/*`) assume it.
  A planned issue's spec lives on that branch, not on the primary checkout, so
  "is it planned?" must check the workspace or the branch ref (PAN-4683).
- **Close-out ceremony lives in `lifecycle/workflows.ts closeOut()`** — `pan close` and
  `POST /api/issues/:id/close-out` both call it. `src/lib/close-out.ts` now holds only
  merge detection (`isBranchMerged`, squash-aware via the merged PR). `closeOut()` reads
  only `close_out.remove_workspace` and `delete_feature_branch`; `close_out.auto` and
  `auto_delay_minutes` have had no consumer since PAN-3917 W4 (`94255f055fe`). The
  closed-issue reaper (`cloister/reap-issue-residue.ts`, every 60 s) removes the
  workspace and deletes local+remote branches of any closed, merged issue regardless of
  `[close_out]` (PAN-4283). Agent-directory cleanup at close-out must go through `pruneAgentStateDir`
  (keeps `state.json`/`sessions.json`); `removeAgentStateDir` is the destructive door
  for deep-wipe, `pan admin db gc-agents`, the startup legacy-row sweep
  (`dropLegacyAgentStatesMissingRoleAsync`), review-agent purge, and swarm reset
  (PAN-3950, PAN-3968).
- **`cleanAgentState` is a whitelist** (`src/lib/agents/agent-state-read.ts`) — every `state.json`
  read and write passes through it, so a field added only to `interface AgentState` is silently
  dropped on save. `foreman`, `modelSpawnKey` and `workspaceId` are dropped today (PAN-4487). Add
  new fields to `cleanAgentState` and cover them with a save→read round-trip test.
- **`spawnRun`/`spawnAgent` never resolve effort** (`src/lib/agents/spawn.ts`) — they persist and
  thread a caller-supplied `effort`/`effortSource` only (PAN-4253 D5). A new launch path must call
  `resolveEffort()` (`src/lib/agents/resolve-effort.ts`) itself or it silently launches at the role
  file's `effort: high` and ignores `roles.<role>.effort`. `pan spawn` builds its pane argv without a
  harness binary (#4511).
- **`tests/unit/lib/lifecycle/workflows.test.ts` has two agent roots** — it mocks
  `paths.js` `AGENTS_DIR` to `<tmpdir>/overdeck-wf-test-home/agents`, but
  `listAgentStatesSync`/`saveAgentStateSync` resolve `getOverdeckHome()` (per-worker
  `OVERDECK_HOME`). Seed agent-state fixtures under `getOverdeckHome()/agents/` or the
  test proves nothing.
- **OpenCode ACP drops permission asks from Task-subagent sessions** (PAN-3937) —
  opencode 1.18.31's `acp/permission.ts` `Handler.process()` looks up the asking
  session via `ACPSession.tryGet(sessionID)` and returns silently if it misses;
  a `mode=subagent` session spawned by the `task` tool is never registered as an
  ACP session, so any permission key opencode defaults to `ask`
  (`external_directory`, `doom_loop`, `read` for `*.env`/`*.env.*`) deadlocks that
  subagent — and the parent's `session/prompt` — forever, with no
  `permission_request` ever written to `acp-session.jsonl`. Subagents inherit the
  parent session's `external_directory` ruleset verbatim
  (`agent/subagent-permissions.ts` `deriveSubagentSessionPermission`), so
  Overdeck's launch-time permission policy (`OPENCODE_PERMISSION` env,
  `buildOpenCodeAcpSpawnInput`) is the only lever that reaches subagents; the
  ACP relay auto-approve path (`AcpHost.handlePermissionRequest`,
  `selectAutoPermissionOutcome`) never fires for them. `OPENCODE_PERMISSION`
  deep-merges last over the user's own `opencode.jsonc`, including any explicit
  `deny` — widening the pre-allow keys widens what a user's own denial can no
  longer block.

- **Unknown harness strings silently behave like Claude Code** — `getHarnessBehavior`
  (`packages/contracts/src/harness-behavior.ts`) and `getTranscriptAdapter`
  (`src/lib/conversations/transcript-adapter.ts`) fall back to Claude, and ~40
  hand-copied harness unions/guard chains (not imported from contracts) compile fine
  when a new literal is missing. Only 7 Records are type-forced (BEHAVIORS,
  POLICY_RUNTIME_NAMES, harness-policy `unlisted: never`, policy decisions,
  HARNESS_BINARY_BY_RUNTIME, HARNESS_MARKERS, frontend HARNESS_BRANDS/HARNESS_LABELS).
  Adding a harness needs a full grep, not typecheck (PAN-3668 PRD has the list).
- **`AcpRuntimeSync.spawnAgent`/`killAgent` are tmux-only** (`src/lib/runtimes/acp.ts`
  `tmuxCreateSession`, `tmux list-panes`) — Cloister crash respawn/kill miss ACP and
  OpenCode panes on a Herdr host. Host-backed harnesses are also hardcoded as
  `acp || opencode` pairs across delivery/messaging/recovery/conversation-runtime.
- **Prime Agent RPC mode spawns a detached per-user daemon** (verified 0.8.0) that
  outlives its client and is restarted by resident workers; managed launches must use
  a private `--daemon-socket` and reap its process group (PAN-3668 D2/D3).
- **The memory governor gates almost nothing** (PAN-4267) — the governor band
  (`assessMemoryPressure`, `cloister/memory-governor.ts`) is read only by the
  memory-pressure patrol (activity feed) and `preemption.ts resumeYieldedAgents`;
  `shed()` has no callers. Conversations and `POST /api/agents` never read it —
  agent starts are gated by `evaluateSpawnGuardrails` (`routes/agents/shared.ts`)
  against `memoryWarnGb`/`memoryBlockGb`, a separate threshold pair. On macOS the
  governor reader (`readProcMemoryDarwin`, `system-health-service.ts`) and the
  header collector (`system-health/darwin.ts`) measured available memory with
  different formulas until PAN-4267 unified them.
- **Agent-memory RAG (not the RAM governor) needs a credentialed provider**
  (PAN-4370) — `memory.extraction.provider: anthropic` uses the Anthropic SDK,
  which needs `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` in the dashboard and hook
  env; a subscription-only host fails every extraction and query expansion (see
  `health.json` `last_failure_detail` under `~/.overdeck/memory/<project>/<ws>/`).
  `searchMemory` ANDs every quoted term (`buildMatchQuery`, `search.ts`), so a
  raw prompt or even 3-5 expanded terms return ~0 FTS hits; prompt-time injection
  must search in OR mode. Expansion calls share `recordHealth` with extraction, so
  `extractions_attempted` also counts expansion calls.
- **`pan memory` reads and writes different fact stores from a workspace** (found
  planning PAN-4940) — `add`/`edit`/`retire` write the cwd checkout, but `show`,
  `list` and the facts `search` prints read the primary checkout unless `--here`
  (`resolveFactTarget`, `src/cli/commands/memory-facts.ts`). Plain `search` omits
  facts from `--json` and searches observations of project `overdeck`
  (`DEFAULT_PROJECT_ID`, `src/lib/memory/cli.ts`) whatever the cwd; PAN-4940 adds
  `--facts` for a cwd-scoped `{ facts, observations }` envelope.

- **Hygiene-scheduler module state lives in the deacon child, not the dashboard**
  — `startHygieneScheduler()` runs from `cloister/service.ts`, which only
  `dashboard/server/deacon-main.ts` starts (a separate Node process). A module
  cache written by a hygiene routine (e.g. `setCachedMemoryVerdict`) is
  invisible to `/api/*` routes in the main process and to `pan` CLI processes;
  `getCachedMemoryVerdict()` is null there. Samplers that feed `/api/resources`
  must run in main (`main.ts` next to `startResourcesSnapshotService`), and
  gates must use a stateless read (PAN-4311). Likewise the runtime mirror behind
  `getAgentRuntimeStateSync`/`isIdle` is populated only in the main process.

- **`git log --all` is not "the repository's history" here.** Overdeck keeps
  tens of thousands of turn-checkpoint refs under `refs/pan/turn/*` (planning and
  work sessions snapshot their trees there). `--all` walks them, so any file a
  session ever drafted reads as "tracked", and the walk is slow. Ask history
  questions of `HEAD` (or a named branch) instead — PAN-4212.

- **Per-issue continue/spec writers target the issue's base workspace, never
  the primary checkout** (PAN-4225) — `resolveIssueWorkspacePlanHome(projectRoot,
  issueId)` in `xbrief/lifecycle-io.ts` is the one place that resolves
  `<project>/workspaces/feature-<issue>`'s plan home; every per-issue writer
  (feedback, session history, `transitionIssueXBrief`, the swarm slot ledger)
  routes through it and writes nothing once that workspace is gone. Readers
  (`readContinueStateForIssue`) check the workspace copy first, then the
  primary. Routine server writes leave `.pan/continues/`/`.pan/specs/` dirty
  and uncommitted in the workspace — `isOverdeckOwnedOnlyStatus`
  (`state-plane.ts`) already exempts both paths from the "uncommitted work"
  gate, so a server-dirtied file sitting there is expected, not a bug. The
  server is NOT lock-free of commits in a workspace, though:
  `commitPendingIssueArtifacts` (`overdeck/plan-artifact-commit.ts`) commits
  both paths at the two spots that would otherwise hit `git rebase`'s refusal
  on a dirty tree — `pan done`'s rebase-and-push step, and the merge
  pipeline's in-place feature-branch rebase (`cloister/merge-rebase.ts`) —
  and `autoCommitWorkspaceChangesBeforeSync` (`merge-agent.ts`, pre-dating
  PAN-4225) already committed `.pan/continues/` before a sync-main rebase for
  the same reason. Don't add a writer that resolves the primary checkout
  directly; route it through `resolveIssueWorkspacePlanHome` like the rest.
- **A `verification.passed` journal tail is ambiguous** (PAN-4221) — quick
  review mode writes no `review.dispatched`, so the tail stays
  `verification.passed` while a healthy quick reviewer runs, AND when a
  dashboard restart killed the push-and-dispatch continuation. The merge gate
  (`merge-verify`) writes the same entry type. Any journal reader that acts on
  this tail must check the entry `source`, the live `agent-<issue>-review`
  parent (not only `-review-*` lanes), and the current primary head8.
  deacon-lite runs only in the deacon child, where
  `getRequestReviewStarter()` is always null — reach the review pipeline via
  `requestReviewThroughRoute`.
- **A live reviewer pane is not proof a review is running** (PAN-4433) — a
  dispatched reviewer can sit idle with no transcript and no report forever
  (PAN-4383, ~21 h). Both deacon-lite review recoveries skip a live pane.
  `reviewDeadlineAt` is write-only since the Cut deleted its reader
  (`deacon-review-signals.ts`, 94255f055fe); PAN-4433 adds
  `reviewDispatchedAt` and `recoverSilentReviewers`. Never write
  `review.redispatched` for a quick-mode issue: `recoverStalledReviews` then
  launches convoy lanes for it.
- **Claude Code's agent selector decides where typed input goes** (PAN-4268) —
  the `● main` / `◯ <type>  <description>` rows under the prompt box. Pasting
  into a pane whose `●` is on a subagent misroutes; with footer focus (`❯` on a
  row) text is swallowed and `x` stops a subagent. Only `Down/Up/Enter/Escape`.

- **Forge PR lookups: failure vs absence, and stale stored URLs** (PAN-4263) —
  `discoverArtifact` (`src/lib/forge.ts`) is called without `repository` by
  every production caller, so it always takes the `gh pr view` path, never the
  GitHub App path. Before PAN-4263 that path swallowed gh errors
  (`2>/dev/null || true`), so a rate limit read as "no PR". The merge path in
  `routes/workspaces/merge-ops.ts` preferred the persisted
  `merge_set_repos.artifact_url` over the freshly resolved PR, which can be a
  long-closed first PR. Treat stored artifact URLs as hints, never as the PR the
  gate judged.

- **New GitHub callers must go through the quota meter** (PAN-4264) — exec
  `gh` with `runGh` (`src/lib/github-quota/run-gh.ts`) and name the caller
  with `withGitHubCaller`, or its spend only shows up as `unattributed` and it
  keeps calling during a pause. The pause gate is per pool and bucket
  (`user`/`pat`/`app` × `graphql`/`rest`), and only the read-model pollers
  are paused. Agent `gh` calls are counted by a shim that lives beside the
  git guard (`launcher-git-guard.ts`), not by `runGh`.
- **REST `/rate_limit` misreports the GraphQL budget** (PAN-4291) — its
  `resources.graphql` said `used: 45` while GraphQL `rateLimit` said
  `used: 2424` at the same moment (2026-09-28), and its `reset` differs too.
  Read the GraphQL bucket with `rateLimit(dryRun: true)` (free). GitHub
  prices `gh pr list` per 100-row page: with `reviewRequests` +
  `statusCheckRollup` a full page costs 3 points, so `--limit 200` costs 6.

- **Two terminal-permission detectors coexist** (PAN-4278) — agents are
  detected by `src/lib/agent-input-detection.ts` (the `1. Yes / 2. Yes, and … /
  3. No` shape); Claude Code conversations use `src/lib/agents/permission-prompt.ts`
  (2- or 3-option prompts, the ` · from the <type> agent` subagent title, the
  `│` reason line). They were deliberately not unified; a Claude Code UI change
  must update both, and the 2.1.280 fixtures pin the second.
- **Check for a permission prompt before ensure-main** (PAN-4278) —
  `ensureMainInputTarget` sends `Down`/`Up`/`Enter`/`Escape`; with a permission
  menu up, `Down` moves the menu cursor and `Enter` answers it. Anything that
  keys a Claude Code pane before pasting must consult
  `conversationPendingPermission` (pane-confirmed `answerable`) first, as the
  composer route does. Never hold or block on a hook-registry entry alone: the
  hook is a best-effort `curl --max-time 1`, so entries can go stale.
- **Composer receipts cache every response for 24 h** (PAN-4278) —
  `withConversationMessageReceipt` replays any response, including a 409 or a
  502, for the same `(name, clientMessageId)`. A resend after a
  `permission-pending` hold or a `not-delivered` failure must mint a fresh
  `clientMessageId` and send no `retry` flag, like the not-found Resend.
- **Origin checks never authenticate** — `validateOriginHeaders` passes a GET
  (so every WebSocket upgrade) that carries no `Origin`/`Referer`. Credentials
  are `hasDashboardAuthHeaders` (session cookie or internal token); peer trust
  (`isLoopbackPeer`, incl. Docker-bridge Traefik) belongs only in the session
  mint and the remote request gate (`isTrustedLocalRequest`,
  `remote-request-gate.ts`), never in `/ws/*`. PAN-1166 routes all `/ws/*`
  upgrades through `ws-auth.ts`. Every Traefik-forwarded request is a
  Docker-bridge peer, so a LAN-reachable Traefik used to make LAN clients look
  local. PAN-4299 binds Traefik to loopback and trusts a bridge peer only when
  its rightmost `X-Forwarded-For` entry is local.
- **Agent-to-pane joins must key by `agentId`** (PAN-4320) — on Herdr a
  `BackendPane`'s `id` (`wKZ:p3`) and `terminalId` (`term_…`) are backend
  handles, never agent ids. Six server sites joined by `terminalId ?? id` and
  served every Herdr agent as stopped. Use `indexPanesByAgentKey` /
  `paneAgentKey` from `@overdeck/contracts` (non-exited pane wins a key
  collision). Test fixtures must be Herdr-shaped; a tmux-shaped pane
  (`terminalId` = agent id) hides the bug. Herdr work agents run without the
  PTY supervisor, so the enrichment poller's `agent.created` is the only way a
  post-boot agent enters the read model's `agentsById`.
- **Composer text reaches Claude Code as a paste** (PAN-4305) — Claude Code
  records a long paste as `<pasted_content id="N">…</pasted_content id="N">`
  in landed and queued records (closer carries the id). Any filter that drops
  user text starting with `<` (`isSystemInjection`, `summary-fork.ts`) hides
  the operator's own message; unwrap through `src/lib/pasted-content.ts` first.
- **The spec is immutable after planning** (PAN-1728) — the required
  `plan-integrity` verification check (`cloister/plan-integrity-run.ts`) fails
  any change to `.pan/specs/<…>-<ISSUE>-*.xbrief.json` beyond five lifecycle
  fields: top-level `status`, `plan.status`, `plan.updated`, `plan.sequence`,
  `xBRIEFInfo.updated`. A new spec writer that touches anything else must make
  a finalize commit with a valid `Plan-Finalized: <sha256>` trailer
  (`xbrief/plan-finalized.ts`) or every open branch fails verification. For a
  polyrepo `pan_records.repo` project, finalize makes that commit in the nested
  plan-home repo, not the wrapper.
- **The stall sweeper is not scheduled** — PAN-3917 W4 (`94255f055fe`) cut the
  only call site of `runStallSweeperPatrol` (`cloister/stall-sweeper.ts`); it
  runs only in tests. Live parked-row readers are `pan parked` and
  `/api/velocity` (both via `parked/resolver.ts`) and `/api/parked`
  (`routes/parked.ts`, its own derivation). Anything added to sweeper output
  has no live emitter until the sweeper is rescheduled (operator decision).

- **Session Vault WIP capture runs in the Stop hook** (PAN-4329) — `pan vault save --hook`
  now builds a temp-index commit, bundles and uploads per turn. Never touch the user's
  index/worktree/stash (temp `GIT_INDEX_FILE` seeded from a *copy* of the real index —
  an empty one drops force-added ignored files), async `execFile` only, and skip when the
  (base, tree) pair is unchanged.
- **The conversation transcript watch is per-viewer, not global** — `watchConversation`
  (`dashboard/server/services/conversation/watch.ts`) starts only inside a `/ws/rpc`
  `subscribeConversationMessages` subscription (`ws-rpc.ts` `streamClaudeTranscript`,
  `Effect.acquireRelease`). Background work that must react to transcript growth (Session Vault
  auto-settle, PAN-4307) needs its own poller; ended conversations never stream and load over
  HTTP `/messages`.
- **Vault git `casRefs` publishes every untracked object in the clone** — `casRefsSerialized`
  (`src/lib/vault/store/git.ts`) runs `git add -A -- .`, so objects left untracked by an
  earlier failed settle ride along with the next successful ref write. Anything that must
  not publish stale objects (key rotation, re-join after rotation, PAN-4333) has to drop
  them first with `discardUnpublished()`. Also: vault ref names are HMACs under the vault key, so a new key renames
  every ref, and `settle` mints a truncated record when an owned record's ref is absent.

- **The whole-document settings save is lossy** — `saveSettingsApi` →
  `writeYamlConfigPreservingComments` (`src/lib/settings-api.ts`) replaces
  `workhorses`/`roles` wholesale, writes env-derived `api_keys` back in plaintext
  (there is no server-side key masking), drops `tts.summarizer.batch_window_seconds`
  and `memory.features.knowledge_index`, and copies project `.pan.yaml` values into the
  global file. Writers that must touch only named keys use a path-scoped
  `parseDocument` + `setIn` edit instead (PAN-4400 model presets).

- **`Effect.forkChild` inside a request handler never runs** (PAN-4432) — in Effect
  4 (`4.0.0-beta.73`) a `forkChild` child is scheduled, not started, and is
  interrupted when its parent fiber exits. A route handler that forks work and then
  returns its response kills that work before it starts, silently: no exit, no log.
  `routes/webhooks.ts` did this from the Effect 4 upgrade until PAN-4432, so no
  GitHub webhook handler ran (CI relay, review auto-start, post-merge, CI chip).
  Background work from a route uses `void work().catch((err) => console.error(...))`
  (`routes/hooks.ts`, `routes/resources/snapshot.ts`); use `Effect.forkDetach` only
  where the work must stay inside the Effect runtime.
- TanStack `rowVirtualizer.measure()` (virtual-core 3.17.11) clears cached sizes
  but re-reads no element; a row whose height did not change gets no
  ResizeObserver callback, and `resizeItem` caches only a changed size. So in
  `chat/messagesTimeline/MessagesTimeline.tsx` never call `measure()` or put
  volatile data (width) in `getItemKey`: rows fall back to estimates and overlap
  (PAN-4497). Re-read mounted rows with `resizeItem` over `elementsCache` instead.
- **Cost and session-index writers copy fields by explicit list** — a new
  field on a cost event or a `sessions.json` line is silently dropped unless it
  is added to every copy: `normalizeSessionEntry` (`session-history.ts`),
  `toCostArchiveEvent` (`overdeck/infra.ts`), the `CostWriter.record` insert and
  `recent()` mapper (`overdeck/cost.ts`), `insertCostEvent`'s column list
  (`overdeck/cost-sync.ts`), and both `toOverdeckCostEvent` copies
  (`costs/reconciler.ts`, `costs/sync-wal.ts`). `cavemanVariant` was lost this
  way. A new `cost_events` column also needs the init SQL plus a
  `runSchemaTopUp` ALTER in `ensureRuntimeIndexesSync` (PAN-4259).
  `cost_events` inserts and updates are rolled up into `cost_issue_rollup` by
  the `cost_issue_rollup_*_v1` triggers (`overdeck/cost-issue-rollup.ts`,
  PAN-4724), so a new writer needs nothing there. A new *aggregated* column, a
  changed grain, or any code that DELETEs `cost_events` rows needs a `_v2`
  install: there is no delete trigger.
- Reasoning effort resolves only through `resolveEffort` (`src/lib/agents/resolve-effort.ts`),
  which also clamps to model∩harness levels; `npm run lint:effort` ratchets new
  `?? 'high'` fallbacks and level-list copies. Clamping runs before Kimi K3
  translation (`src/lib/kimi-effort.ts`), so a Kimi model row must list canonical
  levels, not native ones, or `medium`/`xhigh` clamp wrongly (PAN-4260).
- A Claude Code transcript's modified time is not activity: Claude's
  `touchSessionTranscript` touches every running session's transcript at
  startup and then hourly, adding no record. PAN-4515 makes conversation `lastActivityAt`
  (`overdeck/conversation-list.ts`) take the last `user`/`assistant` record's
  timestamp for live rows, with the modified time only as a fallback.
  Never date conversation activity by transcript modified time.
- AskUserQuestion modal = deny-reason markers: `scanPendingInputs`
  (`src/lib/agent-enrichment.ts`) treats an `is_error` AUQ tool_result as pending
  only if it contains `PAN-1520` or `surfaced to the operator`. Any hook deny that
  must NOT surface (the PAN-4514 junk guard) must omit both strings; any that must
  surface must keep one.
- Text that reaches Herdr must be well-formed UTF-16 (PAN-4506) — a lone
  surrogate (e.g. from a naive `.slice(0, N)` cut through an emoji) makes
  `JSON.stringify` emit an unpaired `\udXXX` escape, and Herdr's `serde_json`
  rejects the whole request with `invalid_request: … unexpected end of hex
  escape`, silently killing a review kickoff. Use `truncateWellFormed` /
  `toWellFormedText` from `src/lib/well-formed-text.ts` for any text (a
  truncated preview, a paste payload) that is heading to a Herdr request.
- **Herdr full frames carry no terminal modes** (PAN-4557) — the first
  `terminal.frame` (`full: true`) from `terminal session observe` repaints the
  grid only; it never replays DEC private modes the app set earlier (`?2004h`
  bracketed paste, mouse, focus), and Herdr v0.9.1–0.9.5 exposes no mode state
  via `pane get`, `session.snapshot` or the stream. The browser's xterm is
  `reset()` before the snapshot, so it starts with every mode off. The fix
  forces `?2004h` into the Herdr snapshot: Herdr's attach input path
  (`apply_terminal_attach_input`) re-wraps a complete bracketed paste to the
  pane's live mode, so this is safe for panes that never enabled it. Mouse
  modes stay off on purpose (drag-select fix `5d2dafcf16d`).
- **Herdr PTY size is not the layout rect** (PAN-4582, probed on herdr 0.9.1)
  — the headless server never pushes a pane's layout rect to its PTY, and a new
  PTY copies the size of the session's FOCUSED pane (any workspace). A pane with
  a 40-row rect can run a 1-row harness. Only a `terminal session control`
  attach (`--cols/--rows`, or `terminal.resize` on stdin) sets the PTY;
  `observe --cols/--rows` never does, and observe frames stay at the observer's
  own size. One controller per terminal: a second gets `already has an attached
  client` on stderr and exits 0. `pane.split` into a shared tab halves the
  remaining rows per launch. `pane.read` nests its text under `result.read`
  (PAN-4586), not `result.text`.
- **Two runtime maps, neither replayed at boot before PAN-4522** — the read
  model's `agentRuntimeById` (`read-model.ts`, served in snapshots) booted `{}`,
  and `syncSnapshot` replaced the client's map wholesale, so a restart showed
  each agent's spawn-time `state.json` `lastActivity` until its next hook beat
  (God View drew busy issues `1h idle`). `AgentStateService` keeps a separate map
  seeded from pane `stateSince`, not from events. Its `RUNTIME_EVENT_TYPES` list
  omits `agent.channel_reply` and `agent.heartbeat_dead`, both of which write
  `agentRuntimeById` in the shared reducer. `state.json` `lastActivity` is live
  only for codex (`recordAgentActivity`, every 5 s); codex posts no
  `agent.activity_changed`, so the God View's row-stamp fallback is codex's only
  liveness signal.
- **Deploy boot preflight reads the entry bundle's text** (PAN-4541) —
  `pan reload` refuses to switch generations when `dashboardServerBootFailure`
  (`src/lib/deploy/dashboard-bundle-integrity.ts`) or `supervisorDeploymentFailure`
  report an unresolvable bare import, via `unresolvedBundleImports`
  (`src/lib/bundle-imports.ts`). Until PAN-4541 lands and the CLI running
  `pan reload` is rebuilt, that scanner is a regex that also matches comments:
  rolldown keeps JSDoc, so any comment reaching `dist/dashboard/server.js` that
  pairs from/import with a quoted word (PAN-4508's `from "custom"`) blocks every
  deploy. Even after the lexer fix, the first reload of a change runs the
  *installed* CLI, so never write that syntax in source comments.
- **`pan reload` holds the restart lock through its unbounded approval wait** (PAN-4888) —
  `src/cli/commands/reload.ts` takes `~/.overdeck/restart.lock` (`caller: 'pan reload'`),
  builds `origin/main`, activates the build (active-bundle record + primary `dist/` swap), then
  waits on the restart gate with no timeout. `pan restart` waits on the gate *before* taking the
  lock, so a waiting reload is the only lock holder that can sit for hours. A newer `pan reload`
  replaces a waiting one through per-newcomer markers (`src/lib/deploy/reload-supersede.ts`); the
  holder steps aside only after `POST /api/restart-gate/withdraw` succeeds. Holders written by an
  older CLI lack `supersedable: true` and still refuse newcomers with exit 2.
- **Most `main` commits are bookkeeping** (PAN-4618) — ~95% of commits on
  `main` are `chore(workspace)` commits touching only `.pan/**` or
  `.overdeck/memory/**`. Once PAN-4618 lands they run no `CI` workflow (only
  `no-planning-on-main`), and CI's concurrency group cancels superseded runs, so
  `main` HEAD usually has no CI run and recent runs may be `cancelled`. Main-CI
  readers decide from CI evidence, never from changed files (a mixed push runs CI
  at a bookkeeping tip): `ci-default-branch-tests.ts` skips commits without a
  decisive test run, DoD row 6 skips candidates missing a required check, and the
  Command Deck chip uses `resolveCiHead` (`ci/project-ci-github.ts`, newest push
  run of `ci.yml`).
- **`fetch-depth: 0` in CI fetches every branch, including `overdeck-state`** (PAN-4917) —
  `actions/checkout` with `fetch-depth: 0` pulls all ~716 heads and ~588 tags. The archived
  `overdeck-state` branch alone holds ~195k commits and ~391k trees not on `main` (main has
  ~20k commits), so a full checkout can take over 5 minutes, and `filter: blob:none` does not
  remove that cost. A job that needs history should fetch only the refs it reads. A job killed
  by its own `timeout-minutes` reports conclusion `CANCELLED`, the same as a superseded run.
  `lint-group (core)` still uses `fetch-depth: 0` (PAN-2227).
- **The transcript heartbeat exists only where `runtimes/index.ts` loaded** —
  `liveness.ts` cannot import the registry (cycle), so `registerLivenessHeartbeatLookup`
  runs as a side effect of `src/lib/runtimes/index.ts`. A process that never loads it
  (most CLI verbs) gets `null` heartbeats; on Herdr, with an empty runtime mirror and no
  tmux `window_activity`, activity then reads as the spawn time. PAN-4595 adds the import
  to `src/lib/health.ts`; `pan worker wait`/`pan lane wait` (`agents/worker/wait.ts`)
  still lack it. Verify with a Node `indexOf` scan of `dist/*.js`, not grep.
- **Herdr streams resolve `herdr` through the child's PATH** (PAN-4630) — the
  probe (`findHerdrBinary`) falls back to `~/.local/bin`, but `startStream` in
  `herdr-stream.ts` spawns the bare `herdr`. Under an `npx` dashboard PATH
  (no `~/.local/bin`) that spawn hit `ENOENT`, which reads as "controlled by
  another client; serving it read-only", then "Connection lost", plus
  `sizing attach refused` at launch. Streams now spawn with
  `herdrSearchDirs()` (exported from `select.ts`) as `PATH`. Any new `herdr`
  spawn must do the same or use the probe's resolved absolute path.
- **The internal token file wins over `OVERDECK_INTERNAL_TOKEN`** (PAN-4628) —
  Herdr and tmux servers are long-lived and every pane inherits their env, so
  an env token can be stale. Readers must read `<OVERDECK_HOME>/internal-token`
  first and use env only when no file exists; `ensureInternalToken()` seeds a
  missing file from env. PAN-4628 converts the seven readers
  (`src/lib/internal-token.ts`, `routes/agents/shared.ts`, the caveman hook
  script, four shell hooks). Never inject the token into a
  pane's env, and never add a reader that checks env first.
  Test consequence (PAN-4881): every test file in a Vitest pool slot shares
  `OVERDECK_HOME=<run root>/worker-<VITEST_POOL_ID>`, and mocking the
  `paths.js` `OVERDECK_HOME` constant does not move the token file
  (`getOverdeckHome()` reads env). A test that authenticates with an env token
  must `rmSync(join(getOverdeckHome(), 'internal-token'), { force: true })`
  before resetting the token cache, or a sibling file's token 401s it.
- **Docker's bridge pool caps live workspace stacks** (PAN-4663) — the host fits
  ~31 bridge networks (`DEFAULT_DOCKER_BRIDGE_POOL_LIMIT`, `docker-bridge-pool.ts`);
  past that, every stack create/rebuild fails "all predefined address pools have been
  fully subnetted". A compose service with neither `networks:` nor `network_mode:`
  makes Compose add an extra `<project>_default` network, so `init-perms` in
  `infra/.devcontainer-template/` sets `network_mode: none`. The renderer reads the
  template from the primary checkout (`devcontainer-renderer.ts`), so a branch's
  template edit reaches workspace stacks only after merge.
- **The dashboard snapshot is the `current` cycle, not every issue** (PAN-4717) —
  the read model feeds `issuesRaw` from `IssueDataService.getIssues()` with
  default options, and `computeIssues` drops canonical `backlog` and `canceled`
  rows (Linear Backlog/Triage/Canceled, GitHub `backlog`/`icebox`/`canceled`
  labels). Closed issues older than `issues.closedWindowDays` are also absent.
  Opening the drawer fires `backfillIssue` (PAN-3659) through
  `subscribeIssueEvents`, which hydrates aged-out closed issues via `issues.delta`
  on the global stream, but it is a no-op for rows the poll holds and the cycle
  filter drops, and `resolveMissingIssue` memoizes failures for the process
  lifetime. A drawer for such an issue shows `Issue details` with no title.
  Never widen the snapshot to fix one view: about 14 frontend views read `issuesRaw`.
- **`npx mint broken-links` is red on `main`** (PAN-4779) — two MDX parse errors
  (a bare `<machine>` in `configuration/linked-machines.mdx`, a bare `<label>` in
  `cli/agent-commands.mdx`) and 15 links in `vision.mdx` to repo files that
  `.mintignore` excludes. `npm run lint:docs` catches `$` in prose and `<` before a
  digit, not `<word>` in prose. Until PAN-4779 lands, scope a docs change's link check
  to its own pages and compare the rest against this baseline.
- **Merge-train AC lookup roots** (PAN-1696, PAN-3165, PAN-4799) — batch members
  are unmerged, so their specs are never on `main`; `memberSpecRoots`
  (`services/uat-member-spec-roots.ts`) orders batch worktree → feature
  workspace → project root. Do not collapse it back to one root.
- **Two tmux oracles answer conversation liveness.** The lifecycle patrol reads the
  runtime census (`list-panes -a`, `src/lib/runtime-census.ts`); the conversation
  list's repair reads `list-sessions` + `conversationHarnessAlive`
  (`src/lib/overdeck/conversation-liveness.ts`), and home's
  `GET /api/machines/conversations` sync runs that repair on a linked machine. When
  they disagree a row flaps active/ended every tick (PAN-4739, Fly VM). Any new
  writer of conversation status must decide through the conversation-liveness door;
  the patrol now confirms through it before ending a row. On the Fly VM the census
  disagreed because tmux without a UTF-8 locale prints `-F` tabs as `_`: any new
  multi-field `-F` reader must pass `-u` (see `listAllPaneRecords` in `src/lib/tmux.ts`).
- **DoD gate: a failed forge read is not absence** (PAN-4821) — `fetchIssuePullRequest` returns
  `{ pr: null }` for "no PR" and `{ pr: null, error }` for a failed read. The DoD verdict rows must keep
  them apart: absence may be waived (strike path, tracker-closed settlement), a failed read may not.
  Never cache an `error` response in the PR-tab cache, and never collapse a read error to `null`.
- **The supervisor restarts any dashboard it watches** (PAN-4861) — `dist/supervisor/server.js`
  (port `dashboardApiPort + 1`) runs `pan restart --dashboard` after 3 failed `/api/health` polls
  and has no "stopped on purpose" state. Anything that stops a dashboard and wants it to stay
  stopped must stop the supervisor first, as `pan down` does (`stopSupervisorUnitIfActive()`,
  else `stopSupervisorProcess()`). The SSH helper's managed stop (`src/lib/anywhere/ssh/helper.ts`)
  follows this rule after PAN-4861.
- **One-host two-dashboard tests: pull adopts into the owner's checkout** (PAN-4774) — `resolveTarget`
  (`src/dashboard/server/services/vault-continue.ts`) prefers the record's saved `cwd` when it exists,
  and on one host the owner's checkout exists for the puller too, so a WIP bundle is never applied
  (`isWipPresent` is true). A test proving "pulled with uncommitted changes" must adopt elsewhere.
  Also keep test `OVERDECK_HOME`s short: `${OVERDECK_HOME}/sockets/pty-conv-<name>.sock` over ~107
  bytes makes the PTY supervisor exit and kills the harness.
- **werift reads one TURN URL** (PAN-4862) — werift 0.25.1 `parseIceServers` keeps only the first
  `turn:`/`turns:` URL, and a blocked UDP allocation falls back to TCP only after ~6.35 s, while
  `setLocalDescription` waits for gathering. Passing Cloudflare's list as-is (UDP first) makes the relay
  route miss its 10 s budget on UDP-blocked networks. The relay route's list goes through
  `relayIceServers` (`src/lib/anywhere/channel/relay-ice-servers.ts`: TLS 443 first, no STUN) on both ends.
  The Shared Sessions host hub (`src/dashboard/server/sharing/peer-hub.ts`) does not reorder: it passes the
  share Worker's TURN list to werift as-is, so its relay path has the same UDP-blocked exposure.
- **Fly VMs and SSH hosts must run home's exact `pan` version from npm** (PAN-4882) —
  `provisionFlyMachine` (`src/lib/anywhere/fly/provision.ts`) runs `npm install -g @overdeck/core@<home
  version>` and throws `version-mismatch` when that fails; the SSH-machine add answers 409
  `version-mismatch`. Both pin to home's version, not npm `latest`, so a newer `latest` is harmless (PAN-4882
  ran on home 0.73.0 with `latest` 0.73.1). Only a deployed version not yet on npm breaks both until it is
  published; live checks then need a branch image built from the deployed commit.
- **`npx @overdeck/core <verb>` depends on bin aliasing** (PAN-4480) — npm's
  `get-bin-from-manifest.js` runs a multi-bin package only when every `bin` value is the same file
  (or one bin is named `core`). `package.json` maps `overdeck` and `pan` to `./dist/cli/index.js`, so
  the zero-install `npx @overdeck/core join <CODE>` on the share invite page works. A bin with a
  different target breaks it with "could not determine executable to run".
- **Fixture PIDs reach the real `process.kill`** (PAN-4925) — code such as `src/lib/smee.ts`
  `stopSmeeProcess()` probes and signals the PID it reads from a pidfile. A test that mocks
  `node:fs` to return a fixture PID (`'12345'`) but does not spy `process.kill` sends a real
  SIGTERM to whatever holds that PID on the host. On CI the vitest fork running the test held it,
  so the worker killed itself: "Worker exited unexpectedly", every test green, and the file
  missing from the `✓ root <file>` list. Spy `process.kill` in any test whose code under test
  signals a fixture PID. 39 test files carry literal PIDs without a `process.kill` spy; most only
  use the PID as data, but none were audited.
- **The access-token snapshot is per process** (PAN-4930 planning) — `verifyAccessToken` and
  `listActiveRecordsOfKind` (`src/lib/access-tokens.ts`) read an in-memory snapshot that only the dashboard
  fills (`startAccessTokenRefresh`, every 5 s). A CLI process (`pan kill`, `pan start`) sees zero records
  unless it calls `refreshAccessTokens()` first (as `pan mcp serve` does) or reads the file with
  `listAccessTokens()`. `verifyAccessToken` also writes `lastUsedAt`, and `mutate` serializes writes only
  within one process, so a CLI write and a dashboard `lastUsedAt` write can lose each other.
- **Self jobs see only the identity env they are given** (PAN-4937 planning) — a self route's `pan` job
  (`src/dashboard/server/services/self-jobs.ts` `selfJobEnv`) has no `$TMUX` and drops every inherited
  identity variable. `pan handoff self` finds its source through `OVERDECK_AGENT_ID` (`src/lib/conversations/current.ts`)
  and `pan task claim` records `OVERDECK_CLAIM_ID || OVERDECK_AGENT_ID || cli-<pid>` (`src/lib/xbrief/claim-check.ts`),
  so a job for a conversation needs `OVERDECK_AGENT_ID=<tmuxSession>` like the conversation's own launcher, or
  handoff fails and the claim is a `cli-<pid>` that `probeHolder` treats as dead. Work agents have no conversation
  row (only `*-review` role runs do), so `pan handoff self` refuses them.
- **MCP SDK clients require the advertised `resource` to share the origin they called** (PAN-4945
  planning) — `@modelcontextprotocol/sdk` 1.30.1 `selectResourceURL` (`client/auth.js:344-357`) throws
  unless `checkResourceAllowed` finds the protected-resource metadata's `resource` on the same origin as
  the `/mcp` URL the client used. Any OAuth issuer for `/mcp` must be derived from the request's host
  (checked against `getTrustedOrigins()`), never a fixed `127.0.0.1`. A stock SDK client also requests
  every `scopes_supported` value at once (`auth.js:229`) and may send no `state` (`auth.js:732`).
- **One merge path per feature (PAN-4970)** — the UAT reconciler drops features
  `mergePathOwner` (`src/dashboard/server/services/merge-path-owner.ts`) assigns to the
  per-PR train from its ready set before it ever assembles a batch; any new merge path
  must ask the same function, or batches churn (30 generations invalidated in a day was
  the original symptom, caused by the per-PR scheduler and the batch reconciler both
  claiming the same unheld, gate-approved PR).
- **Claude Code variadic flags swallow a positional prompt** (PAN-4932 planning, Claude Code 2.1.293) —
  `--allowedTools <x> "prompt"` reads the prompt as another tool name (`claude -p` then fails with
  "Input must be provided"); `--mcp-config <configs...>` is declared variadic the same way in `claude --help`. Launchers that end with `"$prompt"` must
  emit the equals form (`--allowedTools=mcp__overdeck`, `--mcp-config=<path>`) or put another flag
  between. Two equals-form `--mcp-config=` flags both load.
- **Worker waits restart their startup grace on every call** (PAN-4938 planning) — `waitForWorkerReport`
  (`src/lib/agents/worker/wait.ts`) takes `startedAt = now()` per call and counts a death or idleness only
  after `startupGraceMs` (default 60 s) has passed in that call, unless it saw the worker alive. A caller
  that waits in chunks shorter than 60 s (the 50 s MCP wait chunks) never sees a dead worker die: every
  chunk answers `timeout`. Chunked callers pass `startupGraceMs` from the worker's launch time
  (`worker.json` `startedAt`, or a stand-in's `createdAt`). PAN-4938 moves the stand-in wait helpers from
  `src/cli/commands/worker-remote.ts` to `src/lib/agents/worker/wait-any.ts`, because server code never imports `src/cli/`.
- **Codex blocks un-annotated MCP tools** (PAN-4933 planning, Codex CLI 0.159.0) — an MCP tool without a
  `readOnlyHint` annotation needs approval: under `approval_policy = "never"` the call fails with "MCP tool call
  requires approval, but approval policy is never" (observed through `codex exec`), and under `on-request` the TUI
  would prompt (inferred; `codex exec` forces `never`), which wedges an unattended agent. Overdeck's tools carry no annotations, so a server Overdeck provisions into a Codex
  `config.toml` must set `default_tools_approval_mode = "approve"` in its `[mcp_servers.<name>]` table. Codex
  refuses the whole config (the agent never starts) if that key holds anything but `auto`, `prompt`, `writes` or
  `approve`; unknown keys in the table are ignored.
- **ACP agents spawn stdio MCP servers from `session/new` and `session/load`** (PAN-4934 planning probe) —
  opencode 1.18.31 and kimi 2.0.2 both start a stdio `mcpServers` entry, pass its `env` array, keep the
  inherited `PATH`/`HOME`, and call `initialize` then `tools/list`, on a new session and on a load. Both
  advertise `mcpCapabilities: { http, sse }` too. The ACP host's `mcpServers` field
  (`src/lib/acp/session-runtime.ts`) carries the `overdeck` server read from the host's `--mcp-config`
  (PAN-4934); before that it was always `[]`.
- **Work agents have no `conversations` row** (PAN-4943 planning) — `spawnRun` registers one only for
  specialist roles or `registerConversation: true` (`src/lib/agents/spawn.ts:259`); a work agent
  (`agent-pan-<n>`) has none, and `agent-pan-<n>-review` appears only once review starts. Anything keyed
  on "the agent's own conversation" (PR links, the PR sync sweep, `getConversationByName(agentId)`) finds
  nothing for a work agent; PR watches therefore carry their own key and baseline.

- **Launch-context tools block keys on the MCP gate** (PAN-4935 planning) — the managed launch context ends with
  an "Overdeck tools" (MCP) or "Overdeck commands" (`pan`) block chosen by `overdeckMcpEnabledFor`, the same gate
  `prepareClaudeOverdeckMcp`/`prepareCodexOverdeckMcp` check, computed in `claudeSystemPromptFiles`,
  `getAcpLauncherFields` and `materializeMuseContext`. A failed token mint still gets the MCP block. Context
  renderers must import the gate from the leaf `src/lib/mcp/overdeck-mcp-gate.ts`, never `agent-injection.ts`,
  which pulls in the token registry graph.
- **One budget for both the connecting wait and the channel open** (PAN-4885 planning) — `openLinkSocket`
  (`src/lib/anywhere/link-client.ts`) passed `LINK_WAIT_MS` (2.5 s) both to `waitOnline` for a `connecting`
  link and as `timeoutMs` to `openChannel` for the handshake itself. Over the public Fly route
  (`wss://pan-workspaces.fly.dev/ws/link?fly-instance=…`: TLS to the Fly edge, the instance pin, then Noise IK)
  the open misses 2.5 s often enough that two of three `pan worker run --machine fly-…` starts failed against an
  `online` link. PAN-4885 gives the open its own `LINK_OPEN_MS`; `LINK_WAIT_MS` stays the connecting wait. Callers
  that need a shorter bound pass their own `signal` to `linkFetch` (fleet search, versions: 2.5 s per link).
- **Anywhere link failures used to be silent** (PAN-5018) — `RtcTransport.onSignal` swallowed every
  error and returned silently on its drop branches, the channel listener hid `closed`/`timeout` refusals
  (and `toAcceptError` mapped any unexpected exception to `closed`), and `DirectoryClient` logged nothing.
  Now each offer logs `rtc offer from …` plus `answered`, `dropped: <reason>` or `failed at <step>`; the
  directory client logs `directory online|socket closed (<code>)|refused: …`; refusals log
  `channel refused (<code>, <mode>)`; an unexpected handshake exception has the new accept code `internal`.
  Routine lines need `OVERDECK_ANYWHERE_DEBUG=1` (`src/lib/anywhere/debug-log.ts`). The phone evicts its
  peer connections to a machine after a handshake `timeout`/`protocol` failure instead of reusing a zombie.
<!-- last-verified: 2026-11-04 (PAN-4905, PAN-4917, PAN-4925, PAN-4929, PAN-4930, PAN-4931, PAN-4932, PAN-4933, PAN-4934, PAN-4937, PAN-4938, PAN-4940, PAN-4943, PAN-4944, PAN-4945, PAN-4970, PAN-4482, PAN-4885, PAN-5018) -->
- **A local Auto lane pick dropped its explanation** (PAN-5006 planning) — `laneMachineResolver`
  (`src/dashboard/server/routes/lanes.ts`) returned `null` for `target.self`, so `pan lane start --machine auto`
  printed no `Auto → …` line when Auto chose this machine, and `FleetTarget` never carried `answer.rejections`.
  PAN-5006 adds `LaneLaunchResult.placement` (reason plus passed-over machines); `machine` keeps meaning
  "null = runs here", because `handleLaneLaunch` follows a lane only when `machine` is set.
<!-- last-verified: 2026-11-04 -->
- **Session-tree presence was tmux-only on Herdr** (PAN-5011 planning) — `deriveSessionPresence`
  (`src/dashboard/server/services/session-presence.ts`) returns `ended` when the agent id is not in a set built from
  `tmux list-sessions`. On a Herdr host that set never holds an agent, so every work/planning/strike row from
  `/api/session-trees` and `/api/issues/:id/activity` read `ended` and `SessionPanel` locked the composer. PAN-5011
  makes the backend pane authoritative (`presenceForPaneState` in `packages/contracts/src/backend-pane.ts`). Herdr
  `done` is a finished turn with the harness alive, never an exit; only `exited` (or no pane) ends a session. Other
  code still treating `done` as not-live: PAN-4666 (Flywheel `paneIsLive`), PAN-5013 (derived issue state, parked
  route, read-model `activityForPaneState`).
<!-- last-verified: 2026-11-04 -->
<!-- last-verified: 2026-11-04 -->
