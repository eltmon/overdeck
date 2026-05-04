---
specialist: review-agent
issueId: PAN-428
outcome: changes-requested
timestamp: 2026-04-04T01:56:08Z
---

CODE REVIEW BLOCKED for PAN-428:

## PAN-428 STRICT Review: BLOCKED

### Blocking Issue

**1. Branch hygiene: `PAN-428-AUDIT.md` (+476 lines) in repo root**
This is a workspace artifact (self-audit report) that should not be committed to the feature branch. Remove it.

### Non-Blocking Issues (must address before merge)

**2. Missing test files for 7 new infrastructure modules:**
- `src/dashboard/server/config.ts` (98 lines, has testable port validation logic) — NO tests
- `src/dashboard/server/services/domain-services.ts` (EventStoreService, SnapshotService) — NO tests
- `src/dashboard/server/ws-rpc.ts` (128 lines) — NO tests
- `src/dashboard/server/server.ts` (224 lines) — NO tests
- `src/dashboard/server/services/terminal-service.ts` — NO tests
- `src/dashboard/frontend/src/lib/wsTransport.ts` (163 lines, WsTransport class) — NO tests
- `src/dashboard/frontend/src/components/EventRouter.tsx` — NO tests

Only 3 of 10 new modules have tests (event-store, store, recoveryCoordinator). The review requirements state: "Every new function MUST have test files. No exceptions." At minimum, `config.ts` and `domain-services.ts` have easily testable pure logic.

**3. 66 `as any` casts in route modules (body parsing)**
All route handlers use `const { field } = body as any` to destructure the request body from `readJsonBody` (which returns `unknown`). This is inherited from the Express monolith — not new technical debt — but the migration was an opportunity to add Effect Schema validation. Non-blocking for this PR since it maintains feature parity.

**4. `noopIo` duplication**
`const noopIo = { emit: () => {}, on: () => {} } as any` is copy-pasted in 3 route files (issues.ts, misc.ts, mission-control.ts). Should be extracted to a shared module. Non-blocking.

### What Looks Good
- Contracts package: Clean Effect Schema types, 23 events, 9 RPC methods
- Event store: SQLite-backed with PubSub, 7-day retention, dual-runtime
- Frontend store: Pure event reducers, sequence gap recovery
- Path traversal protection in static file serving
- No execSync violations in server code
- Clean database v3→v4 migration
- 15,793-line monolith successfully deleted

### Action Required
1. Remove `PAN-428-AUDIT.md` from the branch
2. Add test files for at minimum `config.ts` and `domain-services.ts`

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-428/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
