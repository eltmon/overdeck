# Performance Review - 2026-06-12T19:17:43Z

## Summary
No blocking performance regressions found. I reviewed the changed session-tree route, changed Command Deck session rendering, the new remote-session terminal/output path, and the related contract/test changes. Overall performance verdict: acceptable to ship, with one non-blocking advisory about the polling shape used for remote terminal output.

## Findings
None.

## Non-blocking Notes

### ~ Remote terminal output polls Fly exec on a fixed 5s cadence — `src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:216`
**Evidence tier:** Tier 1
**Runtime path:** Selected dashboard SessionPanel terminal view for remote Fly agents
**Changed code:** `RemoteSessionOutput` uses `useQuery({ queryKey: ['session-remote-output', sessionId], queryFn: () => fetchAgentOutput(sessionId), refetchInterval: 5_000 })`, and the changed render path mounts it for `isRemoteSession && session.remote`.
**Problem:** The frontend polling itself is bounded to the selected panel, but the endpoint it calls resolves remote output by going through `getRemoteAgentOutput()` in `src/lib/remote/remote-agents.ts:279`, which performs remote Fly execution to ensure tmux context and then `capture-pane`. That makes each open remote terminal view generate periodic remote exec/API work rather than reading from a local stream/cache.
**Impact:** At normal single-operator scale this is unlikely to be user-visible. At 10x concurrent dashboard viewers or several open remote terminals, this becomes repeated Fly exec traffic every 5 seconds and can add avoidable API latency/rate-limit pressure.
**Fix:** Keep the current behavior if remote terminals are rare, but before broadening remote terminal usage, prefer a server-side stream/cache fed by the remote agent or cache the tmux-context setup and add backoff/visibility gating so idle remote terminal panes do not keep issuing remote execs at a fixed cadence.

## Clean Areas Checked
- `src/dashboard/server/routes/projects.ts:471` — session-tree route now shares tmux session names, issue titles, and agent snapshots across project tree assembly; no new blocking I/O or unbounded synchronous work introduced in the changed path.
- `src/dashboard/server/routes/projects.ts:216` — remote-agent session synthesis skips local runtime-state probing for active remote agents, avoiding unnecessary local tmux/runtime checks on that path.
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:481` — changed aggregate work/review badge logic uses small linear filters over per-issue session arrays; no realistic quadratic/list-rendering regression found.
- `packages/contracts/src/types.ts:562` — added remote session metadata schema is fixed-size and does not change payload shape in a way that would materially affect rendering or serialization.
- Changed tests and `.panopticon/projects.yaml` were reviewed for performance-sensitive runtime effects; no regressions found.
