# Conventions

## Process / git
- Feature work happens in git worktrees `workspaces/feature-<issue-lowercase>/` on
  branch `feature/<issue-lowercase>`. Never `git checkout` inside a workspace; never
  `git stash` (commit, discard, or surface instead).
- Conventional-commit subjects, lower-case start, ≤100 chars.
- Quality gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test`.
- `bun install` per worktree (never symlink node_modules); rebuild
  `packages/contracts` if touched.

## Code rules (enforced by review, some by CI)
- **Async tmux primitives only** — new tmux interactions use `*Async`/Effect
  variants in `src/lib/tmux.ts`; never add sync callers. Message delivery =
  load-buffer + paste-buffer + 300ms + `C-m`.
- **No `execSync` in dashboard-server-reachable code** — use promisified `exec`
  or `spawn`; sleep via `await new Promise(r => setTimeout(r, ms))` (PAN-70).
- **Fake timers for any retry/backoff/delay test** — `vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync()`; never real waits, never `maxForks: 1` masking.
- **Skills ↔ CLI lockstep** — changing a `pan <verb>` flag or help string requires
  updating `skills/pan-<verb>/SKILL.md` in the same commit; `scripts/lint-skills.sh`
  (in `npm run lint`) fails CI on drift.
- **Dashboard = Node 22 from `dist/`** — `npm run build` before restarting it;
  never Bun, never tsx (node-pty addon + circular ESM).
- Do not weaken `canUseHarnessSync` (ToS gate) or the `in-flight-guard` test
  (postMergeLifecycle idempotency).

## Frontend
- Follow `pan-style-guide`: no pill badges, no decorative color, muted status
  text; existing icon size classes (`.pickerProviderIcon` 14px, `.agentLogo` etc.).
- State via Zustand with shared reducers from `@overdeck/contracts`; data over
  `/ws/rpc` (Effect RPC) — terminals over raw `/ws/terminal`.
- Inline SVG icons use `currentColor` + a color map (see
  `components/chat/ProviderIcons.tsx` for the existing pattern).

## Planning artifacts (xBRIEF v0.8; post-cut layout, PAN-3917)
- Everything lives under `.pan/` in the project repo (the plan home) and is TRACKED:
  PRD drafts `.pan/drafts/<issue-lowercase>.md`, specs
  `.pan/specs/<date>-<ISSUE>-<slug>.xbrief.json` (immutable after planning except
  `plan.status`), item state `.pan/continues/<issue>.xbrief.json`, plus orders,
  notes, and `backlog/sequence.md`. No daemon commits them: whoever writes a
  planning artifact commits it on the feature branch.
- Workspace working copies (`<workspace>/.overdeck/spec.vbrief.json`,
  `<workspace>/.overdeck/continue.json`) are gitignored; `pan plan finalize`
  promotes them.
- Codebase map: `<projectRoot>/.overdeck/context/codebase/` (tracked).
  `.pan/context/` is the legacy location — read fallback only, gitignored since
  PAN-3930; never write there.
- `pan task` reads and updates the xBRIEF item checklist in `.pan/continues/`.

## Testing
- Vitest, unit tests under `tests/unit/**` mirroring `src/`, plus co-located
  `__tests__/` in some lib dirs (e.g. `src/lib/cloister/__tests__/`).
- Frontend tests co-located under `components/**/__tests__/`.

<!-- last-verified: 2026-09-19 -->
