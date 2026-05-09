# Review Feedback #7 — BLOCKED

**Date:** 2026-03-15
**Reviewer:** review-agent (strict mode)
**Status:** BLOCKED — Do not proceed to testing

---

## BLOCKER 1: +148 net new `as any` casts

This PR adds **155 new `as any` casts** and only removes 7. Net: **+148 `as any`**.

This is a quality gates PR (MIN-757). Adding 148 type-safety escapes while claiming to improve code quality is self-defeating. The `@typescript-eslint/no-explicit-any` rule is set to `'off'` in eslint.config.js — that's the real problem, but adding 148 more while that rule is off makes future enforcement exponentially harder.

**Required action:** Systematically remove new `as any` casts. For each one, either:
- Add proper types (preferred)
- Add a `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <justification>` comment explaining WHY

**Worst offenders:**
- `src/hooks/useCurrentActivity.ts` — 20+ `any` casts on event/task objects
- `src/hooks/useHabitMutations.ts` — `(context as any)` repeated pattern
- `src/components/tasks/UniversalTaskModal.tsx` — `useUnifiedTasks() as any`
- `src/components/tasks/VirtualizedTaskList.tsx` — props spread `as any`
- `src/components/admin/*.tsx` — `toastFn as any` pattern throughout
- `src/services/debriefService.ts` — `(response.data as any).hasAvailableDebrief`

## BLOCKER 2: Duplicate ESLint rule

**File:** `eslint.config.js` lines 51 and 94

`react-hooks/exhaustive-deps: 'warn'` is declared twice — once in the JS rules block (line 51) and once in the TS rules block (line 94). The TS block one overrides the JS block one for TS files, but this is confusing and likely unintentional. Remove the duplicate at line 94 since line 51 already covers it via the shared config.

## BLOCKER 3: AuthContext.test.ts still broken

Previous test run showed `AuthContext.test.ts` fails because the `vi.mock` for jotai is incomplete — it doesn't export `atom`. Fix: use `vi.mock('jotai', async (importOriginal) => ({ ...(await importOriginal()), ... }))` or add `atom` to the mock return.

## BLOCKER 4: No tests for tokenAtoms.ts

`src/atoms/tokenAtoms.ts` was significantly changed (102 lines of diff) — it now contains custom storage logic, JWT decoding, and token refresh orchestration. This is critical auth infrastructure with zero test coverage. Add tests.

## NON-BLOCKING observations

- `src/hooks/useChores.ts:95` — `useOfflineQueueContext()` called but return value discarded. Either use it or remove the call.
- `src/hooks/useChores.ts:359,362` — Double cast `as unknown as EventListener` is a smell. Consider a proper typed wrapper.
- `src/contexts/NavigationContext.tsx` — `persistNavigationState` removed (good), verify no callers remain.
- `src/globals.d.ts` + `src/vite-env.d.ts` — duplicate `gtag` declarations. Pick one source of truth.
- `docs/ci-cd-pipeline.md` — good addition, no issues.
- `CompassSetup.tsx` + test — clean, no issues.

---

**Fix blockers 1-4, then request re-review.**
