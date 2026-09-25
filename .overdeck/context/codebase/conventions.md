# Conventions

## Process / git
- Feature work happens in git worktrees `workspaces/feature-<issue-lowercase>/` on
  branch `feature/<issue-lowercase>`. Never `git checkout` inside a workspace; never
  `git stash` (commit, discard, or surface instead).
- Conventional-commit subjects, lower-case start, ≤100 chars.
- Quality gates before `pan done`: `npm run typecheck`, `npm run lint`, and `npx vitest run <touched test files>`.
  Never run the full `npm test` on the host; CI runs it against the PR head.
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
- Do not weaken `canUseHarness` (ToS gate) or the `in-flight-guard` test
  (postMergeLifecycle idempotency).

## Frontend
- Follow `pan-style-guide`: no pill badges, no decorative color, muted status
  text; existing icon size classes (`.pickerProviderIcon` 14px, `.agentLogo` etc.).
- State via Zustand with shared reducers from `@overdeck/contracts`; data over
  `/ws/rpc` (Effect RPC) — terminals over raw `/ws/terminal`.
- Inline SVG icons use `currentColor` + a color map (see
  `components/chat/ProviderIcons.tsx` for the existing pattern).

## Planning artifacts (xBRIEF v0.8, PAN-1124; relocated under `.pan/` by PAN-3917)
- PRD drafts: `<planHome>/.pan/drafts/<issue>.md` (human-mutable narrative), committed on the feature branch.
- Spec: `<planHome>/.pan/specs/<date>-<ISSUE>-<slug>.xbrief.json` — immutable after planning except `plan.status`.
- Project continue state: `<planHome>/.pan/continues/<issue>.xbrief.json` (written by `pan task`).
- Workspace continue state: `<workspace>/.overdeck/continue.json` (gitignored); item status changes go to its `statusOverrides`, never the spec.
- Legacy `${OVERDECK_HOME}/state/<project>/…` and the `overdeck-state` branch are retired (branch archived, never delete it).
- Agent transcripts: `sessions.json` under `~/.overdeck/agents/<id>/` is the append-only session index; `session.id` is gone (PAN-3950). One async resolver, `src/lib/agents/transcript-resolver.ts`, interprets agent directories; per-harness path formulas live only in `src/lib/runtimes/*`. Conversation search: `chunks.session_id` is always the JSONL basename; subagent chunks carry `parent_session_id`; palette hits on unregistered UUIDs are read-only via the exact-UUID fallback in `conversation-reads.ts` (PAN-3982).

## Testing
- Vitest, unit tests under `tests/unit/**` mirroring `src/`, plus co-located
  `__tests__/` in some lib dirs (e.g. `src/lib/cloister/__tests__/`).
- Frontend tests co-located under `components/**/__tests__/`. CI runs only the frontend files
  listed in root `package.json` `test:frontend-subset` (ci.yml); add new must-run frontend tests there.
- Issue actions: every menu/overflow surface renders from `ISSUE_ACTIONS`
  (`src/dashboard/frontend/src/lib/issueActions.ts`) via `useIssueActions`; removing a key needs a
  `RETIREMENT_AUDIT` row in `issueActions.parity.test.tsx`.

<!-- last-verified: 2026-09-25 -->
