# Concerns / hazards

Live landmines a change in this repo can step on. Verified 2026-09-26.

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
- **Fly Machine rootfs resets on every start** — the rootfs is rebuilt from the
  image on stop/start and on `restart.on-failure`. The ephemeral tier mitigates this
  with a VM-side continuous commit+push heartbeat daemon plus per-bead push
  instructions; the durable tier mitigates it by mounting a persistent Fly volume at
  `/workspace`. Never run durable work without verifying the volume mount
  (PAN-1845).
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
  mint. PAN-1166 routes all `/ws/*` upgrades through `ws-auth.ts`.
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
- PR sync auto-archive liveness is tmux-only: `listLiveConversationSessions` in
  `services/pull-request-sync-service.ts` runs `tmux list-sessions`, but
  conversations launch through the terminal-backend door (Herdr default,
  PAN-3921). With `conversations.auto_archive_on_merge` on under Herdr, every
  conversation reads as not live. Use `getBackendPanes()` + `paneAgentKey`.
- TanStack `rowVirtualizer.measure()` (virtual-core 3.17.11) clears cached sizes
  but re-reads no element; a row whose height did not change gets no
  ResizeObserver callback, and `resizeItem` caches only a changed size. So in
  `chat/messagesTimeline/MessagesTimeline.tsx` never call `measure()` or put
  volatile data (width) in `getItemKey`: rows fall back to estimates and overlap
  (PAN-4497). Re-read mounted rows with `resizeItem` over `elementsCache` instead.
- Reasoning effort resolves only through `resolveEffort` (`src/lib/agents/resolve-effort.ts`),
  which also clamps to model∩harness levels; `npm run lint:effort` ratchets new
  `?? 'high'` fallbacks and level-list copies. Clamping runs before Kimi K3
  translation (`src/lib/kimi-effort.ts`), so a Kimi model row must list canonical
  levels, not native ones, or `medium`/`xhigh` clamp wrongly (PAN-4260).
<!-- last-verified: 2026-10-04 -->
