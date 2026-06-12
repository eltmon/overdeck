# Performance Review - 2026-06-12T07:44:26Z

## Summary
0 blocking performance regressions found. 1 non-blocking advisory: the new remote-session Terminal view polls an expensive remote-output path on a fixed interval while open. Overall verdict: performance is acceptable for merge; tune the remote output refresh path when possible.

## Findings

None

## Non-blocking Notes

### ~ Fixed remote terminal polling can amplify Fly exec load — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:216`
**Evidence tier:** Tier 1
**Runtime path:** Selected remote session Terminal tab only; frontend calls `GET /api/agents/:id/output?lines=200`, whose remote backend path calls `getRemoteAgentOutput()`.
**Changed code:** `RemoteSessionOutput` mounts a React Query with `refetchInterval: 5_000` and `queryFn: () => fetchAgentOutput(sessionId)`.
**Problem:** For remote agents, that endpoint does more than read a local buffer: it detects `remote-state.json`, then calls `getRemoteAgentOutput()` (`/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/agents.ts:1004`), which runs Fly remote exec work to ensure tmux context and capture the pane (`/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/lib/remote/remote-agents.ts:284`). A remote Terminal tab left open therefore drives repeated remote exec traffic every 5 seconds.
**Impact:** Bounded to visible/open remote session panels, so this is not a blocker and does not affect the session-tree list itself. Still, multiple operators or long-lived tabs can create steady Fly API load and make remote terminal refresh sensitive to Fly exec latency/rate limits.
**Fix:** Prefer a single centralized remote-output poller/event stream per remote agent, or at least cache `ensureRemoteTmuxContext` per VM and back off/lengthen the interval when output is unchanged. Keep manual refresh as an escape hatch.

## Clean Areas Checked

- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts`: remote session synthesis skips local tmux/runtime probes for active Fly agents and reuses request-scoped tmux/title/snapshot context; no new synchronous I/O or unbounded concurrency introduced by the changed remote-agent path.
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx`: aggregate badge and session-picking changes are linear in the small per-issue session list; no list-wide render or quadratic regression found.
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/packages/contracts/src/types.ts` and changed tests/config: schema/config/test-only changes do not add runtime hot-path work.
