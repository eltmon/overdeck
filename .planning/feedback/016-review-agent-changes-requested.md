---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-28T23:57:38Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements the core GitHub-native blocker model (schema, webhook ingestion, `readyForMerge` gating, SMEe lifecycle, merge-step UI) with solid test coverage. However, the PR has 4 blockers that must be fixed before merge: (1) the GitHub App bootstrap script silently exfiltrates webhook events to an untrusted third party when smee.io is unavailable; (2) the same script requests overbroad `contents: write` and `pull_requests: write` permissions violating least-privilege; (3) `ReviewStatusSnapshot` in the shared contracts package is missing `queuePosition`, `activeSpecialist`, `mergeRetryCount`, and `mergeNotes` fields required by the dashboard UI and explicitly listed in the requirements; (4) the webhook request path performs synchronous file reads that block the Node.js event loop on every GitHub event.

## Blockers (MUST fix before merge)

### 1. Webhook exfiltration via fallback URL — `scripts/create-github-app.mjs:42-45` — `!`
**Raised by**: security
**Why it blocks**: When smee.io is unavailable the script silently falls back to `https://example.com/hook`, embedding that URL in the GitHub App manifest and causing all webhook events to be delivered to an untrusted third party. This is a direct data-exfiltration path introduced by the bootstrap flow.

<fix instruction>
Wrap the smee channel creation in a non-fallback error path. If `SmeeClient.createChannel()` fails, abort the script with a clear error rather than proceeding with an untrusted URL:

```js
try {
  smeeUrl = await SmeeClient.createChannel();
} catch (err) {
  console.error('Failed to create smee.io channel:', err.message);
  console.error('Refusing to create GitHub App without a trusted webhook URL.');
  process.exit(1);
}
```
</fix>

### 2. Overbroad GitHub App permissions — `scripts/create-github-app.mjs:54-60` — `!`
**Raised by**: security
**Why it blocks**: The manifest requests `contents: write` and `pull_requests: write` which are not needed for the webhook/status feature. If the installation token is compromised, the attacker gains repo-write access beyond what the feature requires.

<fix instruction>
Reduce the requested scopes to the minimum needed for webhook delivery and status reporting:

```js
default_permissions: {
  metadata: 'read',
  checks: 'read',
  statuses: 'write',
  pull_requests: 'read',
}
```

If another existing workflow depends on elevated scopes, that dependency must be justified in code and split from this feature so the privilege increase is deliberate and auditable.
</fix>

### 3. Shared snapshot contract incomplete — `packages/contracts/src/types.ts:143` — `!`
**Raised by**: requirements
**Why it blocks**: `ReviewStatusSnapshot` does not include `queuePosition`, `activeSpecialist`, `mergeRetryCount`, or `mergeNotes` — fields the UI and tests now expect and that the requirements matrix (items 8/9/10) explicitly calls out. The implementation is only complete through a direct API route, not through the canonical shared snapshot/read-model path that other dashboard consumers rely on.

<fix instruction>
Add the missing fields to `ReviewStatusSnapshot` in `packages/contracts/src/types.ts`:
- `queuePosition?: number`
- `activeSpecialist?: string`
- `mergeRetryCount?: number`
- `mergeNotes?: string`

Then update the read-model projection in `src/dashboard/server/read-model.ts:82` to project these fields into the dashboard snapshot. These fields are already being fetched and used by the inspector route; the shared contract gap must be closed for a complete end-to-end implementation.
</fix>

### 4. Synchronous config reads block the dashboard event loop — `src/lib/webhook-handlers.ts:47` — `~`
**Raised by**: performance
**Why it blocks**: Every incoming GitHub webhook event calls `isTrackedRepository()` → `getGitHubConfig()` which synchronously reads and parses `config.yaml` and `projects.yaml` on the Node.js event loop. Under bursty webhook traffic (check runs, check suites, PR updates, review events arriving simultaneously), these sync disk reads serialize concurrent HTTP/WebSocket work in the dashboard process. This directly violates CLAUDE.md's "NEVER use readFileSync in dashboard server code" rule.

<fix instruction>
Cache the allowed-repository set at dashboard startup. The `.panopticon.env` is already cached via `tracker-config.ts` — apply the same pattern for the repository allowlist. Have `isTrackedRepository()` consult only a cached in-memory `Set<string>` rather than re-reading config files on every webhook event. At minimum, avoid `loadYamlConfig()` / `loadProjectsConfig()` from the webhook hot path. The cache can be built once at server startup or lazily on first webhook hit with a stale-time of several minutes.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `src/lib/review-status.ts:299-341` — `?` — Async IIFE fire-and-forget in `setReviewStatus`. The dispatch is intentionally fire-and-forget so the HTTP response isn't delayed, and `dispatch_failed` testStatus is observable via subsequent reads. Safe to defer; consider returning the dispatch promise if callers need to await it. (correctness)
- `src/dashboard/server/routes/webhooks.ts:149` — `?` — The route reconstructs `new Set(ghConfig?.repos.map(...))` on every request. Once config loading is cached (per blocker-4 above), a module-level cached `Set<string>` removes repeated allocation. Small constant-factor improvement. (performance)
- `src/dashboard/server/read-model.ts:157` — `?` — Full review-status reload on every snapshot build. The new blocker data slightly increases per-status JSON parsing. Not a regression from this PR alone; monitoring is appropriate if snapshot frequency or issue count grows. (performance)

## Cross-cutting groups

**GitHub App bootstrap security (items 1 + 2 — same file, same bootstrap flow)**:
- [blocker-1] Webhook exfiltration via fallback URL
- [blocker-2] Overbroad GitHub App permissions

Both are introduced by `scripts/create-github-app.mjs` and must be fixed together in the same script.

**Dashboard snapshot contract (items 3 + 4 — different files, same end-to-end data flow)**:
- [blocker-3] Shared snapshot missing merge metadata fields
- [blocker-4] Sync config reads block event loop on webhook path

Item 4 (caching the repo allowlist) and item 3 (updating `ReviewStatusSnapshot`) are independent fixes but both are on the webhook-to-frontend data path.

## What's good
- The core `BlockerReason` model, SQLite schema migration, and `readyForMerge` gating are correctly implemented with thorough test coverage.
- HMAC-SHA256 webhook signature validation, repo allowlist checks, and dev-bypass restrictions are properly wired.
- SMEe client lifecycle (start/stop/restart) is integrated into CLI and `doctor` checks.
- Review pipeline UI renders all 4 steps (Build Gate / Review / Tests / Merge) with CI check pills and merge status presentation.
- All 14 vBRIEF plan items are marked completed; 18 test cases cover the major blocker and merge-step behaviors.

## Review stats
- Blockers: 4   High: 0   Medium: 0   Nits: 3
- By reviewer: correctness=0, security=2, performance=1, requirements=1
- Files touched: 55+   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

