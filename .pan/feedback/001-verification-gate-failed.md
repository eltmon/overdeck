VERIFICATION FAILED for PAN-1025 (attempt 1/10):

Failed check: test

Verification FAILED at test (34494ms):

un/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:634:39
 ❯ FiberImpl.runLoop node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:651:19
 ❯ FiberImpl.evaluate node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:594:23
 ❯ resume node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:1031:15
 ❯ node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:974:14

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

 FAIL |root|  src/dashboard/server/routes/__tests__/http-handler.test.ts > httpHandler > maps unknown errors to 500
TypeError: Cause.isInterruptedOnly is not a function
 ❯ Array.next src/dashboard/server/routes/http-handler.ts:93:19
     91|         // Interrupt-only causes mean the consumer (browser tab, abort…
     92|         // the request. That isn't a server error — silence it instead…
     93|         if (Cause.isInterruptedOnly(cause)) {
       |                   ^
     94|           return jsonResponse({ error: 'Request cancelled' }, { status…
     95|         }
 ❯ Object.~effect/Effect/successCont node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:1277:26
 ❯ Object.~effect/Effect/evaluate node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:1290:23
 ❯ FiberImpl.runLoop node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:634:39
 ❯ FiberImpl.evaluate node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:594:23
 ❯ runFork node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:5016:9
 ❯ runPromiseExit node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:5094:19
 ❯ Module.<anonymous> node_modules/.bun/effect@4.0.0-beta.45/node_modules/effect/src/internal/effect.ts:5113:5
 ❯ runRoute src/dashboard/server/routes/__tests__/http-handler.test.ts:25:33

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯



## REQUIRED: Fix the failing check, then invoke the /rebase-and-submit skill

1. Read the error output above carefully
2. Fix the code causing the failure
3. Run the failing check locally to verify it passes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-1025 — this is an atomic task. Because verification already ran once (a PR exists), the skill will run `pan review request PAN-1025 -m "Fixed test"` for you. NEVER curl `/api/review/...` or any dashboard endpoint — `pan review request` is the only supported re-entry point.

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until `pan review request` has completed successfully.