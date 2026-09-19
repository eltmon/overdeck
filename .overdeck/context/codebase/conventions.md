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

## Planning artifacts (xBRIEF v0.8, PAN-1124; paths moved by PAN-3917)
- PRD drafts: `.pan/drafts/<issue>.md` in the project repo (or the configured
  plan-home repo for polyrepo projects), committed on the feature branch.
- Spec: `.pan/specs/<date>-<ISSUE>-<slug>.xbrief.json` — immutable after
  planning except `plan.status`.
- Project continue state: `.pan/continues/<issue>.xbrief.json`, written by `pan task`.
- Workspace continue state: `<workspace>/.overdeck/continue.json` (gitignored).
- **No stored status.** The Cut (PAN-3917) deleted the record plane, the
  `review_status` rows, and the status-mirror fields. Pipeline position is
  `DerivedIssueState` (`packages/contracts/src/derived-issue-state.ts`:
  `state`, `attention`, `pr.reviewState`, `pr.checks`), computed at read time.
  `scripts/guard-no-state-layer.sh` (in `npm run lint`) fails on any reference
  to the deleted names in `src/` and in agent-shipped Markdown under
  `sync-sources/` and `src/lib/cloister/prompts/`.

## Testing
- Vitest, unit tests under `tests/unit/**` mirroring `src/`, plus co-located
  `__tests__/` in some lib dirs (e.g. `src/lib/cloister/__tests__/`).
- Frontend tests co-located under `components/**/__tests__/`.

<!-- last-verified: 2026-09-19 -->
