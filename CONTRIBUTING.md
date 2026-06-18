# Contributing to Overdeck CLI

Overdeck is a multi-agent orchestration platform for AI coding assistants. This document covers everything you need to contribute effectively — whether you're a human engineer, an AI agent working an issue, or someone trying to understand how this codebase evolves itself.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Repository Layout](#repository-layout)
3. [Building and Running](#building-and-running)
4. [Branch and PR Workflow](#branch-and-pr-workflow)
5. [Commit Message Convention](#commit-message-convention)
6. [Quality Gates](#quality-gates)
7. [Architecture Rules](#architecture-rules)
8. [Issue Tracking](#issue-tracking)
9. [Filing Bugs](#filing-bugs)
10. [How the Agent Pipeline Works](#how-the-agent-pipeline-works)
11. [For AI Agents Working This Repo](#for-ai-agents-working-this-repo)
12. [Key Invariants](#key-invariants)

---

## Development Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22 LTS | via nvm — `nvm use 22` |
| Bun | latest | build tooling only |
| Git | 2.x+ | worktree support required |
| tmux | 3.x+ | agent sessions |

```bash
# Activate Node 22 (always required)
source ~/.config/nvm/nvm.sh && nvm use 22

# Install dependencies
bun install

# Build the project
npm run build

# Link globally so `pan` is available
npm link
```

### Environment

Copy the example env and fill in secrets:

```bash
cp .env.example ~/.panopticon.env
```

Required secrets are documented in `.env.example`. API keys for Claude, GitHub, and any issue trackers you want to connect.

### Initialize beads (once per project)

Beads is the task tracking system agents use. The binary is installed by `pan install`, but the database must be initialized once per project:

```bash
cd /path/to/overdeck
bd init --prefix panopticon
```

Without this, agents cannot start even when planning succeeds. `pan sync` attempts this automatically for registered projects, but running it once manually on first setup is recommended.

### Verify Your Setup

```bash
pan status          # Should show "Overdeck is running" or offer to start it
pan --version       # Should match package.json
bd list             # Should show empty list (not a "database not found" error)
```

---

## Repository Layout

```
overdeck/
├── src/
│   ├── cli/                    # `pan` CLI commands (Commander.js)
│   ├── dashboard/
│   │   ├── frontend/           # React + Vite dashboard UI
│   │   └── server/             # Effect.js API server + Socket.io + WebSocket
│   ├── lib/
│   │   ├── cloister/           # Agent lifecycle: spawn, route, specialists
│   │   ├── database/           # SQLite query helpers and driver adapter
│   │   ├── workspace-manager.ts
│   │   ├── review-status.ts
│   │   └── pipeline-notifier.ts
│   └── skills/                 # Bundled Claude Code skills shipped with pan
├── packages/
│   └── contracts/              # Shared TypeScript types (RPC schema, domain events)
├── scripts/                    # Shell scripts: post-merge-deploy, webhook relay, etc.
├── docs/
│   └── INDEX.md                # Master documentation index — start here
├── CLAUDE.md                   # Rules for AI agents working in this repo
└── CONTRIBUTING.md             # This file
```

The `src/lib/` modules are shared between the CLI and the dashboard server. Be mindful that anything imported by the server runs in a long-lived process — blocking calls (see [Architecture Rules](#architecture-rules)) will stall every concurrent user.

---

## Building and Running

### Full build

```bash
npm run build           # Compiles TypeScript to dist/ via tsdown + Vite
```

### Development mode

```bash
npm run dev             # Dashboard with hot reload (Vite frontend + tsx server)
```

The dashboard runs on two ports:
- **3010** — Vite frontend
- **3011** — API server

### Starting the production server

```bash
# ALWAYS use the explicit Node 22 path
nohup /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js &

# Or simply:
pan up
```

**Never use `bun run` for the production server.** See [Architecture Rules](#architecture-rules) for why.

### After making changes

```bash
npm run build && npm link   # Rebuild + re-link `pan` globally
```

The deployed server reads from `dist/` — changes in `src/` have no effect until rebuilt.

---

## Branch and PR Workflow

> **IMPORTANT:** This project enforces PRs for all changes to `main`.  
> Direct pushes to `main` are blocked. Every change goes through review.

### Branch naming

Branches are created automatically by `pan start <PAN-XXX>` — you don't name them manually. The branch is always:

```
feature/pan-<number>
```

The prefix comes from `branch_prefix` in `projects.yaml` (defaults to `feature/`). For hotfixes or one-off changes done outside the agent pipeline, follow the same pattern manually:

```bash
git checkout -b feature/pan-<number>
```

### The flow

```
1. Create feature branch from latest main
2. Make changes, commit using conventional commits (see below)
3. Push branch and signal completion: pan done PAN-xxx
   └─ Creates GitHub PR automatically (gh pr create)
4. Review agent runs automated code review, posts GitHub PR review
5. Test agent runs test suite
6. When both pass → readyForMerge = true → human clicks MERGE in dashboard
   └─ merge-agent rebases feature branch onto main (resolves conflicts if any)
   └─ gh pr merge --squash (squash commit to main)
```

### PR checklist

Before opening a PR, verify:

- [ ] `npm run build` passes with no TypeScript errors
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` reports no errors
- [ ] `npm test` passes (or new tests added for the change)
- [ ] No `.beads/` or other ephemeral files staged
- [ ] Commit messages follow the convention below

---

## Commit Message Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description> (PAN-<number>)

[optional body]

[optional footer]
```

### Types

| Type | Use for |
|------|---------|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `test` | Adding or fixing tests |
| `chore` | Build tooling, deps, CI changes |
| `docs` | Documentation only |
| `perf` | Performance improvements |

### Scope (optional but encouraged)

Use the affected subsystem: `cloister`, `dashboard`, `workspace`, `cli`, `review`, `beads`, `db`.

### Examples

```
feat(cloister): add preTrustDirectory to initializeSpecialist (PAN-502)
fix(dashboard): Done column shows 0 issues — selectIssuesByCycle must not filter done (PAN-500)
chore: stop tracking .beads/ — ephemeral, derived from vBRIEF
fix(workspace): git restore after worktree add clears unstaged deletions (PAN-495)
fix(review-status): clear stuck merging status on server restart (PAN-490)
```

### Issue references

Include the GitHub issue number at the end of the subject line. Format: `(PAN-<number>)`. For closes, use `Closes #<number>` as a commit footer.

---

## Quality Gates

All PRs must pass these gates before merge:

### 1. TypeScript typecheck

```bash
npm run typecheck    # npx tsc --noEmit
```

No errors permitted. `any` casts require a comment explaining why.

### 2. Lint

```bash
npm run lint
```

ESLint with the project config. Fix all warnings — we treat warnings as future errors.

### 3. Tests

```bash
npm test
```

**Required Vitest config for all test files and configs:**

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    maxForks: 4,   // MANDATORY — prevents OOM on multi-core machines
  }
})
```

**Do not remove `maxForks: 4`.** Without it, Vitest spawns one worker per CPU core, consuming ~3.5 GB RAM each. On a 24-core machine: 24 × 3.5 GB = OOM and crash.

### 4. No ephemeral files staged

```bash
git status   # Must not show .beads/, *.log, or dist/ changes
```

`.beads/` is gitignored because beads are derived from `plan.vbrief.json` at runtime. They are not repo artifacts. If you see them staged, something has gone wrong upstream — do not commit them.

---

## Architecture Rules

These rules exist because of production bugs we've hit. Violating them causes incidents.

### No `execSync` in server code

`execSync` blocks the Node.js event loop. The dashboard server handles concurrent WebSocket connections, SSE streams, and API requests. A single blocked call stalls all of them.

```typescript
// WRONG
import { execSync } from 'child_process';
const out = execSync('git log');

// RIGHT
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
const { stdout } = await execAsync('git log');
```

The same rule applies to `readFileSync`, `writeFileSync`, `readdirSync`, and `statSync` in route handlers and services. Use `fs/promises` instead. `existsSync` is acceptable (fast stat, no data read). Reference: PAN-70.

### Use Node 22 for the production server — never Bun

Two hard blockers for running the dashboard under Bun:

1. **`node-pty` native addon** — Under Bun's addon compat layer, the PTY spawns but exits with code 0 immediately, breaking `/ws/terminal` for all workspaces.
2. **Circular ESM dependencies** — The dashboard source has circular imports that Bun tolerates but Node.js strict ESM rejects. The compiled `dist/` resolves these at build time via rolldown bundling.

Production start must use the explicit Node 22 binary:

```bash
# CORRECT
/home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js

# WRONG
bun dist/dashboard/server.js
bun run src/dashboard/server/main.ts
```

### tmux message delivery: load-buffer + paste-buffer

When sending text to a tmux pane, never use raw `send-keys` for multi-line content or content that must arrive intact. It races with the pane's input processing.

```typescript
// WRONG
await execAsync(`tmux send-keys -t ${session} "${message}" Enter`);

// RIGHT — use sendKeysAsync() from src/lib/tmux.ts
// Which internally does:
// 1. writeFileSync(tmpFile, message)
// 2. tmux load-buffer <tmpFile>
// 3. tmux paste-buffer -t <session>
// 4. await sleep(300)  — lets text render
// 5. tmux send-keys -t <session> C-m
```

The 300ms delay after `paste-buffer` is not cargo-cult sleep — it gives the pane time to render before the Enter fires.

### Idempotency guards on background services

Background services (agent enrichment, conversation lifecycle, Cloister) must guard against being started twice. Use a module-level `running` flag:

```typescript
let running = false;

export function startMyService() {
  if (running) return;
  running = true;
  // ...
}
```

Duplicate service instances cause duplicate event emissions, double API calls, and subtle race conditions that are extremely hard to debug.

### Always pre-trust directories before spawning agents

Before spawning any Claude Code process in a directory, call `preTrustDirectory(path)`. Without this, Claude Code prompts "Do you trust this folder?" and the session hangs indefinitely waiting for input.

```typescript
import { preTrustDirectory } from '../workspace-manager.js';
preTrustDirectory(targetPath);
// then spawn tmux session
```

This applies to both `spawnSpecialist()` and `initializeSpecialist()` paths. Reference: PAN-502.

### SQLite is the authoritative state store

`review-status.ts`, `event-store.ts`, and the workspace registry write to SQLite first, JSON second. Reads always prefer SQLite. JSON files exist as a legacy fallback for external tooling that reads them directly. Do not invert this ordering.

---

## Issue Tracking

Issues are tracked as **GitHub Issues** on this repository.

- Issue numbers are prefixed `PAN-` in code, commits, and conversation: `PAN-123` = GitHub issue #123
- **This project does NOT use Linear.** MIN-xxx and AUR-xxx are other projects.
- Labels in use:
  - `bug` — incorrect behavior
  - `enhancement` — new feature or improvement
  - `infra` — pipeline, CI, tooling
  - `ux` — dashboard UI/UX
  - `blocked` — waiting on external dependency

---

## Filing Bugs

Use this template when opening a bug report:

```markdown
## Summary
One sentence describing the incorrect behavior.

## Steps to Reproduce
1. ...
2. ...

## Expected
What should have happened.

## Actual
What actually happened. Include relevant log output, error messages, or screenshots.

## Context
- Overdeck version: (run `pan --version`)
- Node version: (run `node --version`)
- OS: (e.g., Ubuntu 24.04)
```

**Severity guidance:**

| Severity | Description | Examples |
|----------|-------------|---------|
| **Blocker** | Pipeline cannot continue | Agent can't spawn, merge button disabled, server crashes on start |
| **Bug** | Incorrect behavior, workaround exists | Status shows wrong value, stale data in UI |
| **Cosmetic** | Visual/display issue, no functional impact | Wrong color, truncated text, alignment off |
| **Enhancement** | Not broken, but could be better | Missing feedback, confusing UX, performance |

---

## How the Agent Pipeline Works

Understanding the full lifecycle helps you contribute to the right layer.

```
Issue Created
     │
     ▼
pan start <PAN-XXX>
     │
     ├─ Fetches issue details from tracker
     ├─ Creates git worktree at workspaces/feature-pan-xxx/
     ├─ bun install (creates workspace-local node_modules)
     ├─ git restore . (clears phantom deletions — PAN-495)
     ├─ git config beads.role agent
     └─ Spawns tmux session → Claude Code agent starts
          │
          ▼
     Agent works (beads workflow)
          │
          ├─ bd ready -l pan-xxx       → find next bead
          ├─ bd update <id> --claim    → claim it
          ├─ implement
          ├─ git add <files> && git commit
          ├─ Update STATE.md
          ├─ bd close <id>             → triggers Inspect Specialist
          └─ WAIT for inspection result (via pan tell)
               │
               ├─ INSPECTION PASSED → next bead
               └─ INSPECTION BLOCKED → fix and re-close
          │
          └─ All beads done → pan done <PAN-XXX>
               │
               ├─ Pushes feature branch
               ├─ Creates GitHub PR (gh pr create)
               ▼
          Cloister detects completion
               │
               ▼
          Review Specialist wakes
               │
               ├─ reviewStatus: reviewing → passed / failed
               ├─ Posts GitHub PR review (gh pr review --approve / --request-changes)
               ├─ If failed:
               │   feedback → agent mail/ → agent reads and fixes → re-submits
               └─ If passed:
                    │
                    ▼
               Test Specialist wakes
                    │
                    ├─ testStatus: testing → passed / failed
                    └─ If passed: readyForMerge = true
                         │
                         ▼
                    Human clicks MERGE in dashboard
                         │
                         ├─ merge-agent rebases feature branch onto main
                         │   (resolves conflicts if any, pushes rebased branch)
                         ├─ gh pr merge --squash (squash commit to main)
                         ▼
                    scripts/post-merge-deploy.sh
                    (flock-guarded, runs npm run build, restarts server)
```

### Review status state machine

```
mergeStatus:  pending → merging → merged
                             ↑
        On server restart: 'merging' → 'pending'  (in-memory state lost — PAN-490)
        In UI after 2min:  RETRY MERGE button appears (isMergeStuck)
```

`mergeStatus: 'merging'` is cleared on server startup via `clearStuckMergeStatuses()` because merge operations are in-memory only — they don't survive restarts. Any `'merging'` status after boot is definitionally stuck.

### Specialist initialization

Specialists (review-agent, test-agent, inspect-agent) are Claude Code processes in their own tmux sessions. They initialize once at server startup via `initializeSpecialist()`. Requirements:

1. Run from the project root (`getDevrootPath()`)
2. Have their directory pre-trusted (`preTrustDirectory()`)
3. Guard against double-init with a module-level `running` flag

---

## For AI Agents Working This Repo

If you're a Claude Code agent assigned to a PAN issue, read this section carefully. It will save you from the most common failure modes.

### Before starting any work

```bash
# 1. Rebase onto latest main (always — even if STATE.md already has progress)
git fetch origin main && git rebase origin/main

# 2. Check STATE.md
cat .planning/STATE.md

# 3. If STATE.md says "Implementation Complete" — you're done
pan done PAN-xxx -c "Work already complete from previous session"
```

### Build before deploy

**Never restart the dashboard server without building first.** Changes to `src/` only take effect after `npm run build`. If you restart without building, the running server reflects the last-built state, not your edits. This is the single most common cause of "I fixed it but it's still broken."

```bash
npm run build
# THEN restart
```

### Stage files explicitly — never `git add -A`

```bash
# WRONG — may stage .beads/, dist/, secrets
git add -A
git add .

# RIGHT
git add src/lib/review-status.ts src/dashboard/server/main.ts
```

If `.beads/` appears in `git status`, do not stage it. It is gitignored intentionally.

### The beads workflow — one bead at a time

```bash
bd ready -l pan-xxx          # Next unblocked bead for THIS issue (-l is mandatory)
bd update <id> --claim        # Claim it
# implement ONLY this bead
git add <specific files>
git commit -m "feat(scope): description (PAN-xxx)"
# Update STATE.md BEFORE closing
bd close <id> --reason="what you did"
# WAIT — inspect specialist fires automatically, result arrives via pan tell
```

Do not batch beads. One bead = one commit = one `bd close`. The inspect specialist verifies each diff individually. Batching causes rejection.

### Completing work

```bash
npm test                                         # Must pass
git add <specific files>
git commit -m "feat: description (PAN-xxx)"
git push -u origin $(git branch --show-current)
git status                                       # Must show clean working tree
pan done PAN-xxx -c "Brief summary"         # MANDATORY — triggers review pipeline
```

`pan done` must be run as a Bash command (via the Bash tool), not typed at the Claude Code interactive prompt. **Ending your turn without calling `pan done` leaves the issue permanently stuck in "In Progress."**

**Do NOT call `pan approve`.** That is a supervisor-only command for humans. Agents always use `pan done`.

### Infrastructure bugs you find while working

When you find a Overdeck bug:

1. **File a GitHub issue immediately**: `gh issue create --title "..." --body "..."`
2. **Blocker?** Fix the code, rebuild, restart, continue. Root cause, not workaround.
3. **Non-blocker?** File the issue, keep going.

**Never manually do what broken code should do.** If an API endpoint should create beads, don't run `bd init` by hand — fix the endpoint. Every workaround is a bug you chose not to fix.

---

## Key Invariants

These properties must be preserved across all changes. A change that would violate one needs discussion before landing.

| Invariant | Why it matters |
|-----------|---------------|
| `mergeStatus: 'merging'` is cleared on server restart | Pending merges are in-memory only. Stale `merging` permanently disables the Merge button. |
| `.beads/` is never committed | Beads are derived from `plan.vbrief.json`. Committing them creates false authoritative state and merge conflicts. |
| `preTrustDirectory()` is called before every agent/specialist spawn | Without it, Claude Code hangs asking "Do you trust this folder?" — the session never starts. |
| `maxForks: 4` in all Vitest configs | 24 cores × 3.5 GB = OOM. Non-negotiable. |
| Node 22 is the production runtime | The production server path must explicitly use the Node 22 binary, not the system default. |
| `execSync` is never used in server-reachable modules | Blocks the event loop, stalls all concurrent requests. |
| SQLite is the authoritative read source for review status | JSON is a legacy fallback. Read logic prefers SQLite; write logic writes both. |
| `git restore .` is called after `git worktree add` | Fresh worktrees have phantom deletions for files on the feature branch not on main. Without this, `git rebase` fails immediately. |
| `pan done` is the agent's mandatory completion signal | It triggers the review pipeline. Agents that stop without calling it leave the issue permanently stuck. |
| Merge requires human action | The Merge button in the dashboard is the only sanctioned merge path. No automated process merges without human intent. |
| `postMergeLifecycle` idempotency guards are never removed | Without guards, the lifecycle loop re-fires indefinitely. The incident burned 24,626 Linear API calls (PAN-328). |
| Docker containers are stopped after merge | Orphaned Docker networks exhaust the bridge pool (~31 max). Without cleanup, new workspaces can't be created. |

---

*This document reflects Overdeck 0.5.x. As the pipeline evolves — branch protection, polyrepo support, remote agents — update this file in the same PR as the feature it documents.*
