---
type: project
description: Workspace frontend node_modules can turn into ~43 dangling
  hash-suffixed links after a verification run; frontend vitest then fails at
  startup with EEXIST; bun install repairs it
updated: 2026-11-03
---

On PAN-4479 (2026-11-03) src/dashboard/frontend/node_modules was rewritten four times between agent turns, each time after a verification run. Its links pointed at node_modules/.bun/<pkg>@<ver>+<hash> folders that do not exist (the store had only <pkg>@<ver>). Frontend vitest then fails before any test runs: vitest.config.ts ensureFrontendNodeModules() sees the dangling link as missing and symlinkSync throws EEXIST; typecheck:frontend reports missing modules (react-query, sonner); the share integration tests could not load miniflare. Cause not verified.

**Why:** the failure looks like a code or merge breakage but is install state; it cost a diagnosis on each recurrence.

**How to apply:** before frontend or share tests in a workspace, run find src/dashboard/frontend/node_modules -maxdepth 2 -xtype l | wc -l; if it is not 0, run bun install in the worktree (never symlink node_modules), then rerun.
