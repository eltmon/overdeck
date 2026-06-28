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
