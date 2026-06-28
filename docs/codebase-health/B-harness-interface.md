# B — Harness interface (Phase 1: the keystone)

**Epic:** B · **Branch:** `codebase-health/harness-interface` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182.
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per coherent step; the orchestrator reviews + merges. This is the **highest-risk** change in the campaign — be conservative, behavior-preserving, and verify with the FULL test suite.

---

## Problem
~117 `harness === 'claude-code'` / `harness === 'pi'` / `harness !== …` conditionals are scattered across the codebase, each re-deciding harness-specific behavior inline. Concentrations: `src/dashboard/server/routes/conversations.ts` (21), `src/lib/agents.ts` (19), `src/dashboard/server/ws-rpc.ts` (7), `src/lib/launcher-generator.ts` (5), `src/lib/settings-api.ts` (4), `src/lib/harness-policy.ts` (4), `src/dashboard/server/services/conversation-service.ts` (4), + a long tail. Find them all: `git grep -nE "harness === |harness !== " -- 'src/**/*.ts'`.

There is **already a runtime-abstraction seam**: `src/lib/runtimes/` with per-runtime modules (`claude-code.ts`, `codex.ts`, `ohmypi.ts`, `ohmypi-fifo.ts`, `pi.ts`, `pi-fifo.ts`) and a registry (`index.ts`). **Read that whole directory first** — the goal is to EXTEND this existing interface, not invent a parallel one.

## Goal (Phase 1 — keystone only)
1. **Analyze** the 117 conditionals and group them into a small set of distinct *behaviors* (e.g. build-launch-command, deliver-message transport, session-id / transcript-path resolution, ToS/auth policy, capability flags, etc.). Produce the behavior list.
2. **Extend the `src/lib/runtimes/` interface** with a method (or capability field) per behavior, and **implement each per-runtime** so the interface can fully replace the inline branches — behavior IDENTICAL to today's conditionals for every harness.
3. **Validate** by migrating **2–3 representative call sites** (e.g. a couple in `agents.ts`) onto the new interface and proving behavior is unchanged. **Do NOT migrate all 117 here** — the bulk is Phase 2 (a fan-out the orchestrator will run per-file once this interface lands).
4. **Write the design doc** (this file — append below the brief): the behavior→method map, the final interface shape, per-runtime implementation notes, and a **Phase-2 migration partition** — a table of `{file → which behaviors/branches → which interface methods to call}` so each fan-out agent has an unambiguous, conflict-free slice.

## Requirements
**FR-1** The extended interface lives in `src/lib/runtimes/` (extend the existing interface/registry; do not create a competing abstraction). Every new method is implemented for ALL runtimes (claude-code, codex, ohmypi, pi, + fifo variants as applicable).
**FR-2** Behavior-preserving: for every harness, the interface method returns/does exactly what the corresponding inline `harness === …` branch does today. Where behavior is subtle (see "Harness facts" below), replicate it precisely — do not "clean up" semantics.
**FR-3** Additive: the 114-ish un-migrated call sites still compile and behave identically (old branches remain until Phase 2). Only the 2–3 validation call sites are migrated here.
**FR-4** `npm run typecheck` + `npm run lint` + **the FULL `npm test` suite** pass (`npx vitest run --configLoader runner`). The full suite is mandatory — a partial/targeted run is NOT acceptable (a prior decomposition went red on main precisely because only a subset was run). Existing runtime tests in `src/lib/runtimes/__tests__/` must stay green; add tests for new interface methods.
**FR-5** When you MOVE harness logic, grep for tests that introspect or import the old location and update them in THIS PR (`git grep -n "harness ===" -- tests/`; also check `src/lib/runtimes/__tests__/`).

**NFR-1** No new explicit `any` (A1 ratchet); new `runtimes/` files < 1000 lines (file-size guard). No `execSync` in server-reachable code (async only). Async tmux primitives only.
**NFR-2** Conservative scope: this PR is interface + per-runtime impl + 2–3 validation migrations + the design doc. Nothing else.

## Harness facts to preserve (from repo rules — replicate, don't redesign)
- **claude-code** Claude work/conversation agents use the **PTY supervisor** delivery path (`dist/pty-supervisor.js`), `OVERDECK_AGENT_ID`, per-agent `pty-token`; `deliverAgentMessage` tries supervisor → legacy Channels MCP → tmux paste-buffer.
- **pi** uses an `rpc.in` FIFO transport; **codex** work agents use `work-tui` mode (never `codex exec`).
- Model routing: kimi → ohmypi, gpt-5.5 → codex, native `claude-*` → claude-code. Pi + Anthropic + subscription auth is ToS-blocked (`harness-policy.ts`).
- Session-id / transcript resolution differs per harness (pi session id lives in the transcript filename; claude-code in launcher-pinned `--session-id`). Preserve exactly.

## Verification
```
git grep -nE "harness === |harness !== " -- 'src/**/*.ts' | wc -l   # baseline before; should drop only by the 2-3 validated sites
npm run typecheck && npm run lint
npx vitest run --configLoader runner        # FULL suite, 0 failed — MANDATORY
```

## Acceptance criteria
- Extended `runtimes/` interface with per-behavior methods, implemented for every runtime; new unit tests for them green.
- 2–3 representative call sites migrated and behavior-identical; remaining branches untouched and still green.
- Full `vitest run` exit 0; typecheck + lint exit 0.
- Design doc section written with the behavior→method map AND a concrete Phase-2 file-partition table.
- Report to the orchestrator when green, with the Phase-2 partition, so the migration fan-out can start.

## Intersecting rules (restated)
No bandaids; behavior-preserving; full-suite verify (NOT a subset); verify against this worktree's post-`main` code; A1 ratchet; file-size guard; async tmux + no execSync; never force `--harness` for CLIProxy models; worktree discipline (branch = `codebase-health/harness-interface`; never `git checkout <branch>`/`git stash`); conventional commits lowercase subject, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers/when-green to the orchestrator.

---
<!-- Executor: append the design doc (behavior→method map, interface shape, per-runtime notes, Phase-2 partition) below this line as you go. -->

## Phase 1 Design Doc

### Behavior Inventory

The current `harness === ...` / `harness !== ...` branches fall into these behavior groups:

| Behavior | Old branch shape | New runtime behavior field |
| --- | --- | --- |
| Launch command family | `harness === 'ohmypi'` builds `omp --mode rpc`; `harness === 'codex'` delegates to Codex work TUI; otherwise Claude Code | `launchCommandKind`, `workAgentMode`, `executableName` |
| Delivery transport | Claude Code prefers PTY supervisor/Channels/tmux; ohmypi uses RPC FIFO; Codex uses `codex exec resume`; conversations sometimes preserve explicit tmux fallback | `deliveryKind`, `usesRpcFifo`, `usesCodexHome` |
| Readiness signal | Codex waits for TUI prompt; Claude Code waits for session signal; ohmypi waits for `ready.json` | `readinessKind`, `readyTimeoutSeconds` |
| Transcript/session storage | Claude JSONL under `~/.claude/projects`; ohmypi JSONL under per-agent sessions; Codex rollout JSONL under per-agent `codex-home` | `transcriptKind`, `sessionIdSource`, existing `getSessionPath()` |
| Context/feed naming | Claude, Pi, Codex context-layer/feed names differ | `contextLayerKind`, `feedKind` |
| Capability gates | PTY supervisor, Channels MCP, streaming, patch projection, prompt-time memory | `supportsPtySupervisor`, `supportsChannelsBridge`, `supportsConversationStreaming`, `supportsPatchProjection`, `injectsPromptTimeMemory` |
| Process liveness | Expected executable in the tmux pane process tree | `processNames` |
| Display/status labels | User-facing runtime names and timeout/error labels | `displayName`, `executableName`, `readyTimeoutSeconds` |
| Validation/normalization | Accept `claude-code`/`ohmypi`/`codex`; normalize legacy `pi` to ohmypi behavior where old state can appear | `getHarnessBehavior(harness)` plus existing `normalizeHarness()`/registry dispatch |

### Interface Shape

Phase 1 extends the existing `src/lib/runtimes/` seam, not a parallel abstraction:

- `src/lib/runtimes/types.ts` now defines `HarnessName`, `HarnessBehavior`, and the small literal unions that describe behavior choices.
- `AgentRuntimeSync` and `AgentRuntime` both expose `getHarnessBehavior(): HarnessBehavior`.
- `src/lib/runtimes/behavior.ts` exports immutable behavior constants for `claude-code`, `ohmypi`, and `codex`, plus `getHarnessBehavior(harness)` for old call sites that have only a harness string.
- `src/lib/runtimes/index.ts` re-exports the behavior API alongside the registry and runtime classes.

The behavior constants intentionally preserve today's quirks:

| Runtime | Key preserved behavior |
| --- | --- |
| `claude-code` | executable/process `claude`; Claude JSONL transcripts; launcher session id; Claude context/feed names; PTY supervisor and Channels-capable; no conversation streaming flag; 30s default readiness. |
| `ohmypi` | executable/process `omp`; RPC FIFO delivery; `ready.json` readiness; session id from transcript JSONL; Pi context/feed names; streaming enabled; no PTY supervisor/Channels; prompt-time memory enabled; 120s readiness. |
| legacy `pi` | `getHarnessBehavior('pi')` returns the exact `ohmypi` behavior object so old persisted state and old branch sites normalize behavior-preservingly. |
| `codex` | executable/process `codex`; Codex work TUI mode; `codex exec resume` delivery; TUI prompt readiness; rollout JSONL transcripts; thread id session source; Codex context/feed names; PTY supervisor-capable but Channels-off; Codex home required; 30s readiness. |

### Phase 1 Validation Migrations

Only three representative `src/lib/agents.ts` call sites were migrated:

1. `hasAgentRuntimeInSubtree()` now gets expected process names from `getHarnessBehavior(harness).processNames`.
2. `waitForPromptReady()` now routes Codex through `getHarnessBehavior(harness).readinessKind === 'codex-tui-prompt'`.
3. `decideSupervisorForWorkAgent()` now uses `supportsPtySupervisor`; missing `state.harness` remains ineligible as before (`harness-unknown`).

Targeted verification for these migrations:

- `npm run typecheck`
- `npx vitest run --configLoader runner src/lib/runtimes/__tests__/registry-dispatch.test.ts`
- `npx vitest run --configLoader runner src/lib/__tests__/agents-spawn-supervisor.test.ts`

### Phase 2 Migration Partition

Use this table for the fan-out. Each agent should touch only its assigned file(s), replace local branches with `getHarnessBehavior(...)`/runtime methods, and update nearby tests that introspect the old branch text.

| Phase 2 slice | File(s) | Remaining branches | Behavior fields / methods to use | Notes |
| --- | --- | ---: | --- | --- |
| conversations-heavy | `src/dashboard/server/routes/conversations.ts` | 21 | `deliveryKind`, `readinessKind`, `transcriptKind`, `sessionIdSource`, `supportsConversationStreaming`, `supportsPatchProjection`, `usesCodexHome`, `contextLayerKind`, `displayName` | Highest-risk slice. Preserve explicit conversation `deliveryMethod` fallback semantics; do not collapse `harnessChanged = harness !== currentHarness` because that is equality detection, not behavior dispatch. |
| agents-followup | `src/lib/agents.ts`, `src/lib/agents/activity.ts`, `src/lib/agents/delivery.ts` | 19 total across these files after Phase 1 (`agents.ts` has 16) | `launchCommandKind`, `workAgentMode`, `deliveryKind`, `usesRpcFifo`, `usesCodexHome`, `contextLayerKind`, `sessionIdSource`, `readyTimeoutSeconds`, `displayName` | Continue from the three migrated examples. Preserve `state.harness` missing/unknown edge cases in eligibility checks. |
| ws-rpc | `src/dashboard/server/ws-rpc.ts` | 7 | `launchCommandKind`, `usesRpcFifo`, `usesCodexHome`, `transcriptKind`, `displayName` | Mirrors route-agent spawning/status decisions; keep legacy `pi` handling behavior-identical. |
| launcher-generator | `src/lib/launcher-generator.ts` | 5 | `launchCommandKind`, `workAgentMode`, `usesRpcFifo`, `usesCodexHome`, `executableName` | This is command construction. Replace branch predicates only after verifying generated launcher snapshots or existing launcher tests. |
| settings-policy | `src/lib/settings-api.ts`, `src/lib/harness-policy.ts`, `src/lib/config-yaml.ts`, `src/cli/commands/start.ts`, `src/cli/commands/handoff.ts`, `src/dashboard/server/routes/issues.ts` | 15 | `getHarnessBehavior()` for display/capabilities where applicable; keep explicit valid-harness sets or add a dedicated runtime validation helper if needed | Validation branches are not all behavior dispatch. Do not replace allowed-value checks with behavior defaults that would accept unknown harnesses. |
| conversation-service | `src/dashboard/server/services/conversation-service.ts`, `src/dashboard/server/services/conversation-lifecycle.ts`, `src/dashboard/server/routes/jsonl-resolver.ts` | 10 | `transcriptKind`, `sessionIdSource`, `supportsConversationStreaming`, existing `getSessionPath()` | Parser selection and lifecycle filtering. Preserve legacy `pi` file detection fallbacks. |
| frontend-feed-stream | `src/dashboard/frontend/src/components/chat/useConversationMessagesStream.ts`, `src/dashboard/frontend/src/components/sessionFeed/useConversationFeed.ts`, `src/dashboard/server/routes/context.ts`, `src/cli/commands/context-layers.ts` | 11 | `supportsConversationStreaming`, `supportsPatchProjection`, `feedKind`, `contextLayerKind`, `displayName` | If importing server-side runtime code into frontend is inappropriate, create a small shared pure behavior module or generated contract; do not duplicate constants by hand. |
| memory-planning-longtail | `src/lib/conversations/smart-compaction.ts`, `src/lib/memory/pipeline.ts`, `src/lib/memory/transcript-source.ts`, `src/lib/graceful-restart.ts`, `src/lib/planning/spawn-planning-session.ts` | 8 | `deliveryKind`, `transcriptKind`, `sessionIdSource`, `executableName`, `supportsPtySupervisor`, `usesRpcFifo`, `usesCodexHome` | Long-tail runtime behavior. Keep source filters that are intentionally data queries if replacing them would obscure query semantics. |
| records-normalization | `src/lib/overdeck/conversations.ts`, `src/lib/overdeck/agent-rollback-state.ts`, `src/lib/pan-dir/record.ts` | 5 | Existing normalization helpers; add a validation helper only if it remains explicit about allowed persisted strings | These branches are canonical state normalization/equality, not necessarily runtime behavior. Be conservative. |
| tests-introspection | `src/lib/cost-parsers/__tests__/ohmypi-parser.test.ts`, `src/lib/__tests__/harness-policy.test.ts`, `src/dashboard/frontend/src/components/Settings/__tests__/SettingsPage.test.ts`, `src/lib/runtimes/__tests__/registry-dispatch.test.ts` | 7 | Update assertions to the new source location when the referenced production branch moves | Required by FR-5. Do this in the same PR as the production migration that moves the referenced logic. |

Post-Phase-1 inventory from this worktree:

```bash
git grep -nE "harness === |harness !== " -- 'src/**/*.ts' | cut -d: -f1 | sort | uniq -c | sort -nr
```

The largest remaining files are `conversations.ts` (21), `agents.ts` (16), `ws-rpc.ts` (7), `launcher-generator.ts` (5), `settings-api.ts` (4), `harness-policy.ts` (4), and `conversation-service.ts` (4). The new runtime behavior file and registry test intentionally contain a few harness comparisons to implement and verify the central dispatch itself.
