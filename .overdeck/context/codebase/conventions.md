# Conventions

## Process / git
- Feature work happens in git worktrees `workspaces/feature-<issue-lowercase>/` on
  branch `feature/<issue-lowercase>`. Never `git checkout` inside a workspace; never
  `git stash` (commit, discard, or surface instead).
- Conventional-commit subjects, lower-case start, ≤100 chars.
- Quality gates before `pan done`: `npm run typecheck`, `npm run lint`, and `npx vitest run <touched test files>`. Never run the full `npm test` on the host; CI runs it against the PR head (PAN-3965).
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
  updating `sync-sources/skills/pan-<verb>/SKILL.md` in the same commit; `scripts/lint-skills.sh`
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
- Dialogs opened from a menu use a zustand store plus a host mounted in
  `main.tsx` (`LinkPullRequestDialogHost`, `ContinueOnDeviceDialogHost`), so the dialog outlives
  the menu.

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
- Frontend tests co-located under `components/**/__tests__/`, `lib/__tests__/`, or beside the
  source file (e.g. `lib/simple/*.test.tsx`, `chat/messagesTimeline/messageRows.test.tsx`). CI
  runs only the frontend files listed in `scripts/frontend-test-subset.txt` (one path per line,
  relative to `src/dashboard/frontend`, `merge=union`; run by `npm run test:frontend-subset`);
  add new must-run frontend tests there in sorted position.
- Tests that run the real `createWorkspace` (`src/lib/workspace-manager/create.ts`) or
  `rebuildWorkspaceStack` (`src/lib/workspace/rebuild-stack.ts`) must mock `checkDiskFloor` and
  `reserveDiskFloor` in `src/lib/disk-floor.js` and `estimateWorkspaceDiskCost` in
  `src/lib/workspace/disk-cost.js` (as well as `util.promisify` for `createWorkspace`): the floor
  reads the temp dir's real free space with `statfs`, CI runners sometimes have less (PAN-4723),
  and the estimator runs real `git` and `docker` (PAN-4961).
- Issue actions: every menu/overflow surface renders from `ISSUE_ACTIONS`
  (`src/dashboard/frontend/src/lib/issueActions.ts`) via `useIssueActions`; removing a key needs a
  `RETIREMENT_AUDIT` row in `issueActions.parity.test.tsx`.
- Frontend Vitest resolves `*.module.css` keys to stable hashed names (`_conversationItem_10de07`),
  even for keys the stylesheet lacks: import `styles` and assert `toHaveClass(styles.x)`, but prove
  a rule exists by grep, not by a test. A mutation test that needs `invalidateQueries` to wait must
  mount a `useQuery` observer on that key; with no observer it resolves at once.
- Playwright `getByRole(..., { name })` is a case-insensitive substring match (testing-library's is
  whole-string): use `exact: true` for short names like `Yes`, and build e2e fixture timestamps
  from `Date.now()` (PAN-4757).
- Browser specs (`tests/e2e/*.spec.ts`: Vite dev server + Chromium) run inside the default unit
  shards. A fresh-context `page.goto` costs ~5–7 s on a loaded CI runner, so give each route its
  own `it` and keep an `it` to ≤3 page loads within its 45 s budget (PAN-4767); the serial
  browser lane is PAN-4733.
- Playwright specs under `src/dashboard/frontend/tests/` run in CI only when listed in the
  `test:playwright` script of `src/dashboard/frontend/package.json`. To put issues/agents in the
  store there, seed `localStorage['pan-snapshot-cache-v1']` with `addInitScript` and close
  `/ws/rpc` (`pan-4523-river-bands.spec.ts`); never add a production store hook.

- Issue IDs are `LETTERS-NUMBER`: `parseIssueId` (`src/lib/issue-id.ts`) and dozens of path/session regexes assume a letters-only prefix, so project issue prefixes must be letters only; use `issue_pattern` for other ID shapes (PAN-4860).
- Root `setupFiles` (`vitest.config.ts`) run in order: `tests/setup/overdeck-home.ts`,
  `tests/setup/no-real-home-writes.ts`, `tests/setup/no-worker-signals.ts`, `tests/setup.ts`; the
  latter two guards throw `[test-guard]` errors (PAN-4925).

<!-- last-verified: 2026-11-03 -->
