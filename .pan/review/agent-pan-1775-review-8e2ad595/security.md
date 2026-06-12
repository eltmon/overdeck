# Security Review - 2026-06-12T07:49:24Z

## Summary
Reviewed the changed server session-tree route, contract shape, remote-session UI rendering, project configuration, and associated tests for security regressions introduced by this PR. I found 0 security blockers and 1 low-risk defense-in-depth advisory; overall security verdict: no blocking security vulnerabilities found in the changed code.

## Findings
None.

## Non-blocking Notes

### ? Consider bounding the batch session-tree project list — `src/dashboard/server/routes/projects.ts:551`
**Evidence tier:** Tier 1
**Changed code:** The new `GET /api/session-trees` route reads `projects` from the query string, splits it on commas, and runs `Promise.all(projectKeys.map(...fetchProjectSessionTree...))` without an explicit cap or de-duplication.
**Security relevance:** This is not a blocker because the endpoint is dashboard-local/authenticated in the normal deployment path and does not expose secrets beyond the same data as the per-project tree route. As defense in depth, a very large or duplicate `projects` parameter could still amplify filesystem scans of workspace and agent state and create avoidable local resource pressure.
**Fix:** Cap the number of project keys processed per request, discard duplicates before dispatch, and return `400` for over-limit requests.

## Clean Areas Checked
- `src/dashboard/server/routes/projects.ts`: remote agent session synthesis reads only local Panopticon state files, does not expose remote tokens, avoids tmux attachment for remote sessions, and uses fixed/canonical session IDs for local terminal exposure.
- `packages/contracts/src/types.ts`: added `SessionNode.remote` carries only `provider` and `vmName`; no credential fields were added to the dashboard contract.
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx`: remote output is fetched with an encoded agent id and rendered as React text inside `<pre>`, not as HTML or markdown, so remote terminal content is not introduced as XSS-capable markup.
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx`: new aggregate badges and remote-agent labels render through React text/title attributes; no `dangerouslySetInnerHTML` or script-capable rendering path was added.
- `.panopticon/projects.yaml`: changed-file test gate uses the existing quality-gate command mechanism; no credentials, destructive commands, or externally supplied URLs were introduced by the changed Panopticon project config.
