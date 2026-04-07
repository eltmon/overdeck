# PAN-506: Start Agent silently fails when beads DB not initialized

## Problem

When the Dolt database for beads hasn't been initialized in a workspace, clicking "Start Agent" does nothing visible. The API returns a 422 but:
1. `complete-planning` silently swallows beads creation failures (console.warn only)
2. `POST /api/agents` auto-recovery also fails silently
3. The frontend has inline error display but it's tiny `text-xs` red text — easy to miss, no toast

## Root Cause

`complete-planning` (`issues.ts:873-880`) catches `createBeadsFromVBrief` errors as non-fatal warnings and continues to write `.planning-complete`. This means planning appears successful even when beads were never created, and the user only discovers the problem when Start Agent fails.

## Decisions

1. **Fix complete-planning to surface beads failure** — return `beadsWarning` in the response when creation fails, so the frontend can alert the user at planning completion time (not just at agent start)
2. **Upgrade Start Agent error UX** — add `toast.error()` alongside the existing inline display so the 422 is impossible to miss
3. **Improve auto-recovery error detail** — include the specific failure reason in the 422 response (e.g., "bd CLI not found" vs "database not found") so users know what to fix
4. **Harden beads.ts auto-init** — the redirect-exists-but-DB-doesn't path should retry `bd init --prefix` more aggressively

## Approach

### Layer 1: Frontend (toast + better messaging)
- Add `onError` callback to `startAgentMutation` with `toast.error()`
- Keep inline error as backup
- If complete-planning returns `beadsWarning`, show toast at planning completion too

### Layer 2: Backend — complete-planning
- After `createBeadsFromVBrief` fails, include `beadsWarning` in the JSON response
- Don't fail the endpoint (planning artifacts are still valid) but make the warning visible

### Layer 3: Backend — POST /api/agents
- Include auto-recovery failure reason in the 422 error message
- Surface the specific `createBeadsFromVBrief` error (bd not found, db init failed, etc.)

### Layer 4: beads.ts — robust initialization
- When redirect exists but DB connectivity fails, always attempt `bd init --prefix`
- Return structured error info so callers know exactly what failed

## Files to Modify

1. `src/dashboard/frontend/src/components/InspectorPanel.tsx` — add `onError` toast to startAgentMutation
2. `src/dashboard/frontend/src/components/inspector/ActionsSection.tsx` — optionally enhance inline error styling
3. `src/dashboard/server/routes/issues.ts` — return `beadsWarning` from complete-planning
4. `src/dashboard/server/routes/agents.ts` — include recovery error detail in 422
5. `src/lib/vbrief/beads.ts` — harden auto-init, better error reporting

## Out of Scope

- Changing the beads redirect mechanism
- Modifying the `bd` CLI itself
- Adding beads initialization to the planning agent prompt
