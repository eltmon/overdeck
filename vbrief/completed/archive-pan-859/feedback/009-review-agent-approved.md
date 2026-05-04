---
specialist: review-agent
issueId: PAN-859
outcome: approved
timestamp: 2026-04-27T23:06:17Z
---

# Verdict: APPROVED

## Summary
PAN-859 fixes a stale-closure bug in the Command Deck's session selection: the old selector was closed over `selectedFeature`, causing the first click on a work-agent row to not update the terminal pane. The fix subscribes to the full `selectedSessionByIssue` map and derives the selected session ID outside the selector. All four acceptance criteria are verified (3 with automated tests, 1 with Playwright). The CSRF relaxation for GET/HEAD is intentional and documented. Two dead-code warnings and two test suggestions are advisory only.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/conversations.ts:340` — `~` — Dead unreachable fallback return. After the early-return at lines 314–319 handles the no-origin/no-referer case, the `return { ok: false, error: 'Missing origin' }` at line 340 can never fire. Restructure as a final `else` block or remove the unreachable branch. (correctness)
- `src/dashboard/server/routes/__tests__/conversations.test.ts:407` — `~` — Dead code in test-local `validateOrigin`. Mirror the production restructure (remove unreachable fallback) when fixing the production code above. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/CommandDeck.test.tsx:355` — `?` — Test gap: "clears session view when switching to a conversation" verifies old elements disappear but doesn't assert the conversation panel renders. Add `expect(screen.getByTestId('conversation-panel')).toBeInTheDocument()` after the conversation click. (correctness)
- `src/dashboard/server/routes/conversations.ts:314–319` — `~` — CSRF weakening informational. The early-return allows bare GET/HEAD (no Origin/Referer) to bypass validation. Acceptable for localhost-only dashboard; GET endpoints are safe. No code fix needed. (correctness)

## Cross-cutting groups

**Dead code in conversations.ts origin-validation block** (same root cause — unreachable fallback after early return):
- [nit-1] `conversations.ts:340` — unreachable fallback `return { ok: false, error: 'Missing origin' }`
- [nit-2] `conversations.test.ts:407` — mirror dead code in test-local `validateOrigin`

Fix together: restructure the if/else chain so the final `return` is only reachable as an `else` branch.

## What's good
- Stale-closure root cause correctly identified and fixed: subscribe to full `selectedSessionByIssue` map, derive `selectedSessionId` outside selector
- Three new regression tests with proper `beforeEach` store reset and async waits
- CSRF relaxation correctly scoped to safe methods (GET/HEAD only) with documented rationale
- All 4 acceptance criteria verified (3 automated, 1 Playwright with screenshots)
- Security reviewer confirmed no new injection, auth bypass, or data exposure risks

## Review stats
- Blockers: 0   High: 0   Medium: 0   Nits: 4
- By reviewer: correctness=4, security=0, performance=0, requirements=0
- Files touched: 5   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

