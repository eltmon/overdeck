# PAN-645: Tests: root Vitest config does not discover ActionsSection.test.tsx

## Problem

The root `vitest.config.ts` include patterns (`tests/**/*.test.ts`, `src/**/__tests__/**/*.test.ts`) don't match colocated `*.test.tsx` files in the frontend. Running `npx vitest --run <path-to-frontend-test>` from root fails with "No test files found". There are 13 colocated `.test.tsx` files affected, not just `ActionsSection.test.tsx`.

Even if the root patterns were expanded, the root config uses `environment: 'node'` with no jsdom or React plugin — frontend tests would still fail.

## Decision

Use **Vitest workspace configuration** (`vitest.workspace.ts`) to unify test discovery across the monorepo. This is Vitest's built-in solution for multi-project setups.

## Approach

1. Create `vitest.workspace.ts` at project root referencing all three vitest configs:
   - `vitest.config.ts` (root — CLI/server backend tests, node env)
   - `src/dashboard/frontend/vitest.config.ts` (frontend tests, jsdom env)
   - `apps/desktop/vitest.config.ts` (desktop tests, node env)

2. Update `package.json` test script from:
   ```
   vitest --run --no-file-parallelism && cd src/dashboard/frontend && npm test
   ```
   to:
   ```
   vitest --run --no-file-parallelism
   ```
   Since the workspace config will discover frontend tests automatically.

3. Verify that `npx vitest --run src/dashboard/frontend/src/components/inspector/ActionsSection.test.tsx` succeeds from root.

## Convention

Colocated `*.test.tsx` files alongside components is the accepted convention for frontend tests. The `__tests__/` convention is also acceptable. Both are discovered by the frontend vitest config.

## Scope

- Create `vitest.workspace.ts`
- Update root `package.json` test script
- Verify discovery works
- NOT moving any test files
- NOT changing individual vitest configs
