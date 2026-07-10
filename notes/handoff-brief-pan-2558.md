# Brief: implement PAN-2558 (polyrepo state-branch migration) — operator-supervised bypass

Read, in order, before writing any code:
1. `~/.overdeck/state/panopticon-cli/drafts/pan-2558.md` — the **PRD, execution source of truth** (glossary, decisions D1–D4, work items WI-1…WI-6, acceptance criteria). Where anything is ambiguous, the PRD's decisions win; if a decision is genuinely missing, STOP and ask here.
2. https://github.com/eltmon/overdeck/issues/2558 — the issue.

## Your workspace (NOT the primary checkout)
- You are in an **isolated git worktree** at `/home/eltmon/Projects/hoff-pan-2558` on branch **`bypass/pan-2558`** (based on origin/main). This is deliberate: the Flywheel (RUN-62) is live and commits to `main`, so you must NOT touch the primary checkout.
- **First:** run `bun install` from the worktree root (fast, hardlinked — never symlink node_modules). If you change `packages/contracts/`, rebuild it (`cd packages/contracts && npm run build`).
- **Verify your branch before your first edit and after any rebase:** `git branch --show-current` must be `bypass/pan-2558`; `git rev-parse --show-toplevel` must be `/home/eltmon/Projects/hoff-pan-2558`. NEVER `git checkout <other-branch>`, never branch off, never touch `/home/eltmon/Projects/overdeck`.
- Commit per work item on `bypass/pan-2558`, path-scoped, never `--amend`, never `git stash`, never push. The **operator reviews your branch and merges it to main** — you do not merge, you do not run `pan done`, you do not restart/spawn/resume anything.

## What to build (from the PRD)
- **WI-1** route `state-migrate.ts` through `resolveInfraRepo(project).repoPath` (host repo) while reading legacy `.pan`/`.beads` from `project.path` (source); handle the source-vs-host split (D2/D3).
- **WI-2** make the sync/legacy resolvers (`state-read-home.ts:31`, `state-home.ts:167-168`) consistent with the async `resolveStateHome` — resolve via `resolveInfraRepo`, never bare `project.path`. Mind the PAN-2550 import cycle (`state-read-home.ts` was extracted to break it) — if importing `projects.ts` reintroduces a cycle, thread the path in from the caller and say so.
- **WI-4** extend `tests/integration/state-branch-no-loss.test.ts` with a polyrepo fixture (root dir + `infra/` sub-repo + `.pan`/`.beads` at root + `pan_records: { repo: infra }`); assert state lands on the sub-repo's `overdeck-state`, root state removed, sub-repo `main` untouched.
- **WI-6** docs: `configuration/state-branch.mdx` (add a "Polyrepo projects" subsection) + `docs/AGENT-STATE-PLANES.md`.

## Hard boundaries — do NOT do these
- **WI-3 (set MyN `pan_records` in `~/.overdeck/projects.yaml`) is the operator's, not yours** — it's machine-local config. Do not edit `projects.yaml`.
- **WI-5 (the live MyN GitLab cutover) is the operator's** — do NOT run `pan admin state migrate mind-your-now`. Implement + test the code path only.
- Do not migrate any project, do not push, do not restart the dashboard/deacon, do not spawn agents.

## Repo rules that intersect (restated)
- No `execSync` in server-reachable code (the migration CLI uses async `git()` helpers — keep it). Fake timers for any delay/retry test. `sendKeysAsync` only for tmux. Match the surrounding style; surgical changes only.
- **Known migration bug you MAY fix under WI-1's robustness** (seen live 2026-07-10 on `myn-cli`): the `git add -- .gitignore .overdeck/context` step fails with `pathspec '.overdeck/context' did not match any files` when a project has no `.pan/context`. Guard it (only add `.overdeck/context` if the context move produced files). Mention it in your summary if you fix it.
- Quality gates before you call it done: `npm run typecheck` + `npm run lint` green, and your changed-module test files green. Run the pre-existing suites for every module you touch (the PAN-2541 lesson: 31 regressions hid in untouched-by-you tests).

## Done means
WI-1, WI-2, WI-4, WI-6 implemented + tested + committed on `bypass/pan-2558` (NOT pushed). In your final summary: a per-WI → commit → test mapping, note anything deferred with its reason, and flag the import-cycle outcome for WI-2. STOP and ask here if any step needs a decision the PRD doesn't make.
