---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T00:17:04Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-905 implements a full final-merge workflow: a 4-step pipeline stepper, blocker-aware Awaiting Merge page, GitHub webhook handlers for CI/PR/review events, smee-client relay lifecycle, and a new GitHub App bootstrap flow. Two findings block this merge: (1) the GitHub App webhook relay routes sensitive repository event data through a third-party smee.io endpoint, exposing PR titles, reviewer identities, commit SHAs, and workflow status to an uncontrolled relay — a Tier 1 data-exposure path under OWASP A02:2021; and (2) the webhook route's dev-mode missing-secret behavior does not match the approved vBRIEF requirement, returning `503` instead of gracefully skipping with a warning. All other findings are correctness issues in `webhook-handlers.ts` (the same file, same `mergeable_state` logic root cause) and one test isolation defect. The work agent must address both blockers before this PR can merge.

## Blockers (MUST fix before merge)

### 1. Third-party webhook relay exposes GitHub event data to smee.io — `scripts/create-github-app.mjs:37`, `scripts/create-github-app.mjs:50`, `scripts/update-github-app-webhooks.mjs:69`, `src/lib/smee.ts:202` — `!`

**Raised by**: security

**Why it blocks**: The GitHub App manifest sets `hook_attributes.url` to a `smee.io` channel and the runtime relay forwards payload from that third-party endpoint to the local dashboard. Every subscribed webhook event — PR titles/bodies, review comments, reviewer identities, commit SHAs, branch names, check status — transits and terminates at an uncontrolled relay before reaching Panopticon. The `X-Hub-Signature-256` verification downstream only authenticates that GitHub originally signed the body; it does not prevent disclosure to the relay operator or anyone with channel access. This is OWASP A02:2021 / Sensitive Data Exposure, and it is a Tier 1 / MUST block on any private repository.

<fix instruction>

Do not use a third-party relay as the production GitHub App webhook endpoint. Use a first-party reachable endpoint under your control:

```typescript
// In scripts/create-github-app.mjs and scripts/update-github-app-webhooks.mjs,
// replace the smee channel URL with the actual deployed dashboard webhook URL:
webhook_url = "https://your-panopticon-domain.example.com/api/webhooks/github";
```

If smee.io is needed strictly for local development, restrict it to explicit dev mode and refuse the flow in production:

```typescript
// At the top of create-github-app.mjs and update-github-app-webhooks.mjs:
if (process.env.PANOPTICON_DEV !== '1') {
  throw new Error('Refusing to configure a third-party webhook relay outside dev mode');
}
```

The smee.io relay design must not become the default or recommended webhook transport for normal repository operation.

---

### 2. Dev-mode webhook-secret graceful handling does not match approved vBRIEF requirement — `src/dashboard/server/routes/webhooks.ts:128-139` — `!`

**Raised by**: requirements

**Why it blocks**: The approved vBRIEF item `webhook-route.ac3` requires "gracefully handles missing webhook-secret (logs warning, skips verification in dev)". The current implementation returns `503` for all non-local requests missing a secret, only bypassing when `PANOPTICON_DEV_WEBHOOKS=1` **and** the request is localhost. This is stricter than the approved requirement, which called for a genuinely graceful dev-mode path (log warning, skip verification, proceed).

<fix instruction>

Align the implementation with the approved requirement by adding a path that logs a warning and skips HMAC verification when `PANOPTICON_DEV_WEBHOOKS=1` is set and the webhook secret is absent — regardless of remote address:

```typescript
// In src/dashboard/server/routes/webhooks.ts, before the 503 response:
if (!webhookSecret && process.env.PANOPTICON_DEV_WEBHOOKS === '1') {
  console.warn('[webhooks] PANOPTICON_DEV_WEBHOOKS=1 but WEBHOOK_SECRET not set — skipping HMAC verification (dev only)');
  // proceed without signature verification
} else {
  return res.status(503).json({ error: 'Webhook secret not configured' });
}
```

Or, if the stricter behavior is the intended product decision, update the vBRIEF requirement in `plan.vbrief.json` to reflect the actual implemented contract.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `merge_conflict` blocker incorrectly added for `mergeable === false` with non-dirty states — `src/lib/webhook-handlers.ts:178` — `~`

**Raised by**: correctness

The condition `pr.mergeable === false || pr.mergeable_state === 'dirty'` fires for **any** non-mergeable state, not just merge conflicts. When GitHub reports `mergeable === false` with `mergeable_state === 'behind'` (branch outdated but no conflict), a `merge_conflict` blocker is incorrectly added alongside `not_mergeable`. The requirement specifies `merge_conflict` should only be added for `mergeable_state === 'dirty'`.

<fix instruction>

```typescript
// Narrow to only fire when mergeable_state is definitive:
if ((pr.mergeable === false && pr.mergeable_state === null) || pr.mergeable_state === 'dirty') {
```

Or rely solely on `mergeable_state === 'dirty'` (the authoritative conflict signal) and drop `pr.mergeable === false`.

---

### 2. `not_mergeable` condition may fire for semantically valid future GitHub states — `src/lib/webhook-handlers.ts:161-174` — `~`

**Raised by**: correctness

The condition `pr.mergeable_state !== 'unknown'` means any unrecognized `mergeable_state` value (including future GitHub values) triggers `not_mergeable`. A future GitHub `mergeable_state` that is actually mergeable would incorrectly block the PR.

<fix instruction>

Use an explicit allowlist instead of a blocklist:

```typescript
const MERGEABLE_STATES = new Set(['clean', 'unstable', 'has_related_reviews']);
if (!MERGEABLE_STATES.has(pr.mergeable_state)) {
  // either skip adding not_mergeable, or add it with the actual state in details
}
```

---

### 3. `process.kill` mock not fully restored after test — `tests/unit/lib/smee-process.test.ts:116-126` — `~`

**Raised by**: correctness

`vi.clearAllMocks()` in `afterEach` only resets call history — it does **not** restore the original `process.kill` implementation. If a test throws before reaching the restore line, `process.kill` remains mocked for subsequent tests in the same file.

<fix instruction>

Use `vi.spyOn(process, 'kill')` instead of direct reassignment. Vitest's spy lifecycle is handled automatically:

```typescript
it('is idempotent when already running', () => {
  const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined);
  // ...
  // no explicit restore needed — afterEach handles it
});
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx:95` — `?` — Per-issue workspace fetch scales O(n) with ready items. Add a bulk endpoint when the queue grows beyond a handful. (performance)
- `src/lib/smee.ts:202-204` — `?` — `closeSync(logFd)` not called in the falsy-pid path, causing fd leak until function exit. Move into the success path after the pid check or use try/finally. (correctness, suggestion)

## Cross-cutting groups

**`mergeable_state` logic in webhook handlers** (related findings that share a root cause — fix together):
- [blocker-1] (partial) `merge_conflict` added for `mergeable === false` with non-dirty states — `webhook-handlers.ts:178`
- [high-1] `merge_conflict` incorrectly triggers for `mergeable === false` with `mergeable_state === 'behind'`
- [high-2] `not_mergeable` triggers for unrecognized future GitHub `mergeable_state` values

Both findings in `src/lib/webhook-handlers.ts:161-178` stem from the same `mergeable_state` / `mergeable` condition block and should be addressed together.

## What's good

- HMAC-SHA256 verification and repository allowlist in webhooks.ts are solid defense-in-depth and should remain mandatory.
- The 4-step pipeline stepper (Build Gate → Review → Tests → Merge) is cleanly implemented.
- Blocker-aware Awaiting Merge page correctly excludes `blockerReasons` items from the ready list.
- SQLite schema migration adds `blocker_reasons TEXT` with indexed upsert — no N+1 patterns introduced.
- Blocked merge rows surface full `blockerReasons` arrays with type/summary and details expansion.

## Review stats

- Blockers: 2   High: 3   Medium: 0   Nits: 2
- By reviewer: correctness=3, security=1, performance=1, requirements=1
- Files touched: ~53   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

