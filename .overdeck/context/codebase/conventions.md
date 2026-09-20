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

## Planning artifacts (xBRIEF v0.8, PAN-1124)
- PRD drafts: `.pan/drafts/<issue-lowercase>.md` in the project repo (or the
  configured plan-home repo for polyrepo projects), committed on the feature
  branch (human-mutable narrative).
- Spec: `.pan/specs/<date>-<ISSUE>-<slug>.xbrief.json` on `main` — immutable
  after planning except `plan.status`.
- Project continue state: `.pan/continues/<issue-lowercase>.xbrief.json`, written by `pan task`.
- Workspace continue state: `<workspace>/.overdeck/continue.json` (gitignored,
  mirrored to the project continue state at finalize).
- `pan plan finalize` promotes the workspace draft/spec through the write door;
  the legacy `overdeck-state` branch and `${OVERDECK_HOME}/state/` layout are
  retired — do not write there.

## Testing
- Vitest, unit tests under `tests/unit/**` mirroring `src/`, plus co-located
  `__tests__/` in some lib dirs (e.g. `src/lib/cloister/__tests__/`).
- Frontend tests co-located under `components/**/__tests__/`.

<!-- last-verified: 2026-09-20 -->
