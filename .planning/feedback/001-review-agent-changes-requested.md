---
specialist: review-agent
issueId: PAN-862
outcome: changes-requested
timestamp: 2026-04-27T10:31:12Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-862 introduces a Resource Discovery service and Command Deck UI that surfaces all resource-allocated issues across projects with per-row resource icons and hover popovers. The implementation is structurally sound — no sync blocking in server code, proper async patterns, good cache hygiene — but falls short on two fronts: the discovery benchmark runs at ~1203ms, 20% over the required `< 1s` target (a hard blocker per policy), and the added Playwright spec for visual verification is not wired into the CI verification flow. Additionally, one critical CI supply chain risk (unpinned `curl | bash`) must be addressed.

---

## Blockers (MUST fix before merge)

### 1. Discovery does not meet `< 1s` performance requirement — `src/dashboard/server/services/resource-discovery.bench.ts:24` — `!`

**Raised by**: requirements

**Why it blocks**: The issue's acceptance criterion explicitly requires "Discovery completes in < 1s for current workload (28 worktrees, 124 branches)." The benchmark currently reports 1202.76ms — a 20% overage. A missing acceptance criterion is a blocker by policy.

**Fix instruction**: Profile the uncached path in `resource-discovery.ts` to identify the slowest data source (likely `gh pr list` or filesystem scans). Optimize the hot path so the benchmark passes consistently below 1000ms. If the workload environment differs from CI, add a gating mechanism (e.g., `@slow` tag or environment-based threshold) and document the expected variance.

---

## High Priority (SHOULD fix; changes_requested until addressed)

### 1. Session array eager cloning defeats O(changed-features) update behavior — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:305` — `~`

**Raised by**: performance

The merge step clones every feature's session array with `[...feature.sessions]` before comparing it back, so `treeSessions === feature.sessions` is never true for features with sessions. This means every poll/delta rebuilds every `ProjectFeature` object in the project, not just the changed one. Under live session updates with many visible features, this causes unnecessary full-project re-renders.

**Fix instruction**: Remove the eager clone — use `featureSessions.set(feature.issueId.toLowerCase(), feature.sessions)` directly (no spread). Only copy when constructing the server payload or for the specific feature being updated.

### 2. Playwright spec not wired into CI verification flow — `src/dashboard/frontend/tests/command-deck-resource-strip.spec.ts` — `~`

**Raised by**: requirements

The visual verification spec exists and exercises icon rendering, hover details, and orphaned cleanup, but the CI workflow (`.github/workflows/ci.yml:91,98`) only runs `npm test` and the benchmark. The Playwright spec is excluded by `vitest.config.ts:22` from the default test path.

**Fix instruction**: Wire the Playwright spec into an executed frontend E2E step in the CI workflow (e.g., add a `npm run test:e2e` step that runs Playwright), or provide documented evidence that the visual check was run and passed. Without this, the acceptance criterion "Visual verified with Playwright" cannot be confirmed.

### 3. cleanup-workspace missing issue ID validation before path construction and `rm -rf` — `src/dashboard/server/routes/issues.ts:1741–1764` — `~`

**Raised by**: correctness

The `:id` URL parameter is used directly in `join(projectRoot, 'workspaces', \`feature-${issueLower}\`)` and `rm -rf` shell commands without `parseIssueId()` validation. The `sync-discussions` route (line 2764) uses the pattern correctly; this one doesn't. A crafted `id` containing path traversal characters could reach unexpected paths.

**Fix instruction**: Add `parseIssueId(id)` (or a regex guard like `/^[A-Za-z]+-\d+$/`) before constructing filesystem paths and before any shell command that uses the derived path.

### 4. Duration NaN propagation when timestamps are present but invalid — `src/dashboard/server/routes/command-deck.ts:413–415` — `~`

**Raised by**: correctness

The truthiness check (`ss.startedAt && ss.endedAt`) confirms both values exist, but invalid date strings (e.g., `"not-a-date"`) cause `new Date(...).getTime()` to return `NaN`, which propagates into transcript formatting.

**Fix instruction**: Guard with `Number.isFinite()`:
```typescript
const ms = new Date(ss.endedAt).getTime() - new Date(ss.startedAt).getTime();
const duration = Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
```

### 5. Inconsistent issue ID validation across `:id` routes — `src/dashboard/server/routes/issues.ts` — `~`

**Raised by**: correctness

`parseIssueId()` is imported (line 38) and used in `sync-discussions` (line 2764), but several routes that accept `:id` do not validate: `GET /api/issues/:id/resource-details`, `POST /api/issues/:id/cleanup-workspace`, `POST /api/issues/:id/deep-wipe`. While invalid formats will fail to find a project and no-op, the inconsistency invites future mistakes.

**Fix instruction**: Apply `parseIssueId()` consistently at the top of every `:id` route, or extract a shared validation middleware.

### 6. `sanitizeResourceDetailIdentifiers` name is misleading — `src/dashboard/server/services/resource-discovery.ts:652–654` — `~`

**Raised by**: correctness

The function delegates to `summarizeResourceDetailIdentifiers` which **preserves** infrastructure identifiers (workspacePaths, tmuxSessionNames, etc.). The name implies sanitization (removal of sensitive data), but it actually performs summarization — the opposite of what `sanitizeResourceAllocatedIssues` does (which genuinely strips paths). A reader will be confused expecting sanitization similar to the public endpoint.

**Fix instruction**: Rename to `toPublicResourceDetailIdentifiers` or `summarizeDetailIdentifiers` to accurately reflect the behavior.

### 7. Unpinned remote install script execution in CI — `.github/workflows/ci.yml:33,59,80` — `~`

**Raised by**: security

The workflow installs Bun by piping a live network response directly into `bash`:
```yaml
run: curl -fsSL https://bun.sh/install | bash
```
No version pinning, no checksum verification, no pinned action digest. If the remote endpoint is compromised, an attacker gets arbitrary code execution inside the GitHub Actions runner.

**Fix instruction**: Use a pinned GitHub Action with a commit SHA, or a versioned Bun release download with checksum verification before execution.

---

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:433,504` / `ProjectTree/FeatureItem.tsx:123` — `?` — Missing `encodeURIComponent` in URL interpolations for issueId. Not strictly needed for PAN-XXX format, but inconsistent with the session-trees call at line 97 which correctly uses it. (correctness)
- `tests/unit/dashboard/server/services/resource-discovery.test.ts` — `?` — Test data includes fields not in the public `ResourceDetails` interface (workspacePaths, localBranchNames). Works at runtime but suggests test was written against internal shape. Align test data with `ResourceDetails` or add a clarifying comment. (correctness)
- `src/dashboard/server/services/resource-discovery.bench.ts` — `?` — 1s benchmark threshold may be exceeded in CI environments with slow I/O or Docker cold start. Consider a more generous CI threshold (3–5s) or gate behind a `@slow` tag. (correctness)
- `src/dashboard/server/services/resource-discovery.ts:157` — `?` — `parseIssueIdFromText` regex matches broad patterns (e.g., `feature-123`). Acceptable for discovery but document the intentional breadth. (correctness)

---

## Cross-cutting groups

**Input validation inconsistency** (fix together):
- [blocker] REQ-7 — Performance benchmark over target
- [high-3] cleanup-workspace missing issue ID validation before path construction (`rm -rf`)
- [high-5] Inconsistent issue ID validation across `:id` routes

**Session rendering churn**:
- [high-1] Session array eager cloning defeats O(changed-features) update behavior
- [high-4] Duration NaN propagation (same code path, different symptom)

**CI supply chain**:
- [high-7] Unpinned `curl | bash` in CI
- [nit-2] Benchmark CI threshold fragility

---

## What's good

- No blocking sync calls in server code — all filesystem and subprocess calls are properly async
- Stale-while-revalidate cache with proper promise deduplication is well-implemented
- Public endpoint correctly sanitizes all infrastructure identifiers; detail endpoint intentionally surfaces them for the hover popover
- `computeResourceAllocatedIssues()` gracefully handles subprocess failures with try/catch per data source
- Deep-wipe is gated behind `window.confirm()` on the frontend
- Effect.js route composition is consistent with existing patterns

---

## Review stats

- Blockers: 1   High: 8   Medium: 0   Nits: 4
- By reviewer: correctness=4, security=2, performance=1, requirements=2
- Files touched: 15   Files with findings: 10

---

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — logic errors, null/undefined handling, edge cases, type safety, data flow
- `performance.md` — server-side regressions, hot path analysis, algorithmic efficiency
- `requirements.md` — coverage against issue acceptance criteria, missing/partial requirements
- `security.md` — vulnerabilities, supply chain risks, input validation, exposure control

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-862 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

