---
specialist: review-agent
issueId: MIN-757
outcome: changes-requested
timestamp: 2026-03-15T21:36:26Z
---

CODE REVIEW BLOCKED for MIN-757:

BLOCKED — 3 CRITICAL runtime bugs, 2 missing test files, widespread any abuse.

## CRITICAL (Runtime Bugs)

1. **NavigationContext.tsx:105** — `persistNavigationState` variable removed, `useCallback` return discarded = dead code. Stray semicolon after `=>`. The function is never called. Remove the entire dead useCallback block (lines 104-115).

2. **useOfflineMutation.ts:53,66** — `onSuccess`/`onError` callbacks have WRONG signature. TanStack Query v5 passes `(data, variables, context)` — 3 args. Code adds a phantom 4th param `onMutateResult` and forwards 4 args to user callbacks. The `onMutate` context (3rd arg) is being renamed to `onMutateResult` and then the real context slot gets `undefined`. This BREAKS mutation rollback.

3. **useVoiceDebug.ts:161,166** — Event listener results discarded (`siriListener`, `appUrlListener` removed) + stray semicolons. Listeners can never be cleaned up = MEMORY LEAK on repeated calls.

## BLOCKING (Missing Tests)

4. **AuthContext.ts** — New module with `useAuth()` and `useAuthContext()` hooks. NO test file. Required per review policy.

5. **CompassSetup.tsx** — New component. NO test file.

## HIGH (Type Safety — defeats MIN-757 purpose)

6. **eslint.config.js:70** — `@typescript-eslint/no-explicit-any: 'off'` — This is a bandaid. The entire point of MIN-757 is quality gates. Disabling the any-checker undermines everything.

7. **useCurrentActivity.ts** — 20+ instances of `(event: any)`, `(task: any)`, `(a: any, b: any)`. Massive any proliferation in core activity logic.

8. **useHabitMutations.ts:90,104,107,108** — Double `as any` casting on mutation context. Should be properly typed via onMutate return type.

9. **vite-env.d.ts:38,46** — `any` types for error handler and Capacitor global.

10. **CustomerProvider.d.ts:13,20** — `members?: any[]` and `[key: string]: any` index signature.

11. **chores.ts:106** — WebSocket event `data: any` untyped.

12. **debrief.ts:295-297** — `todaysTasks?: any[]`, `todayEvents?: any[]`.

## MEDIUM (Dead Code / Cleanup)

13. **NavigationContext.tsx:105-115** — Dead useCallback (covered in #1).

14. **globals.d.ts + vite-env.d.ts** — Duplicate gtag declarations.

15. **useChores.ts:617** — `useOfflineQueueContext()` called, return value discarded.

16. **AuthContext.ts:38-40** — Silent catch swallows JWT decode errors with no logging.

17. **quality-gate.yml** — Node 22 hardcoded but package.json engines says ^20.9.0.

Fix #1-5 minimum before re-review.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/MIN-757/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
