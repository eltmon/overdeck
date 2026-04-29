---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T17:09:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This PR implements PAN-905’s GitHub-native merge blocker pipeline across webhook ingestion, review-status persistence, dashboard merge-gate UI, and smee relay management, and most of that scope is present. The verdict is `CHANGES_REQUESTED` because one requirement remains incomplete: `pan up` does not start the smee webhook relay on the Electron-app startup path in `src/cli/index.ts:560`, so the required lifecycle behavior is not consistently delivered; separately, the new `pull_request synchronize` flow in `src/lib/webhook-handlers.ts:336` can reject the very webhook that should refresh the stored head SHA and clear stale blockers, which is a high-priority correctness bug that should be fixed before merge.

## Blockers (MUST fix before merge)

### 1. `pan up` skips smee startup on the Electron-app path — `src/cli/index.ts:560` — `!`
**Raised by**: requirements
**Why it blocks**: The stated PAN-905 requirement says `pan up` must start the smee-client lifecycle, and the Electron fast path returns before the shared startup block runs.

Refactor `pan up` so every launch mode, including the Electron-app path, runs the same post-launch smee startup sequence after the dashboard is available, rather than relying on a later shared block that some paths bypass.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `pull_request synchronize` events are dropped before stored PR identity can be refreshed — `src/lib/webhook-handlers.ts:336` — `~`
**Raised by**: correctness

Change `handlePullRequest()` so synchronize/opened/reopened events update or validate PR identity in an order that tolerates head movement. The handler should not require the old stored `prHeadSha` to match before it reaches the code that refreshes `prHeadSha` and recomputes blockers.

## Nits (advisory — safe to defer)

- `src/lib/webhook-handlers.ts:523` — `?` — Branch scanning stops after the first invalid feature ref. Change `break` to `continue` so later candidate branches in the same status payload can still be checked. (correctness)
- `package.json:110` — `?` — Dependency scanning for Bun-managed lockfiles. Keep automated CVE scanning in the Bun toolchain or CI because `npm audit` cannot evaluate `bun.lock`. (security)
- `src/lib/webhook-handlers.ts:266` — `?` — Sequential webhook updates could become a bottleneck only if multi-PR payloads become common. Parallelize bounded independent updates if this admin-path workload grows in practice. (performance)

## Cross-cutting groups

**Webhook review-status reconciliation** (related findings that share a root cause — fix together):
- [high-1] `pull_request synchronize` events are dropped before stored PR identity can be refreshed
- [nit-1] Branch scanning stops after the first invalid feature ref

**Webhook relay lifecycle completeness** (startup/operability gaps around the GitHub webhook path):
- [blocker-1] `pan up` skips smee startup on the Electron-app path
- [nit-2] Dependency scanning for Bun-managed lockfiles

## What's good
- The webhook route verifies `X-Hub-Signature-256`, rejects untracked repositories, and avoids introducing new security findings in the reviewed paths.
- The dashboard and persistence work appears well integrated: blocker reasons flow through the DB, shared contracts, read model, and Awaiting Merge / merge-step UI without duplicate PR-query fetches.

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 3
- By reviewer: correctness=2, security=1, performance=1, requirements=1
- Files touched: 75   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

