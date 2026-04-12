# PAN-645: Tests: root Vitest config does not discover ActionsSection.test.tsx

## Status: In Progress

## Current Phase
Creating workspace config (bead feature-pan-489-mtq). Vitest upgraded to 2.x to support workspace project mode; frontend config updated to use absolute paths.

## Completed Work
- (in progress) feature-pan-489-mtq: Create vitest.workspace.ts + upgrade vitest 1.x→2.x + fix frontend config paths

## Remaining Work
- [ ] feature-pan-489-mtq: commit and close
- [ ] feature-pan-489-jm3: Simplify npm test script (remove the `&& cd frontend && npm test` suffix)
- [ ] feature-pan-489-0ra: Verify discovery + full suite

## Key Decisions
- **Vitest 2.x instead of 1.x**: Vitest 1.6.1 has a bug where `defineWorkspace` loads configs but fails test execution with "Cannot read properties of undefined (reading 'config')" at the `describe` call. Upgrading to 2.1.9 fixes this. Not upgraded to 4.x because v4 changed `vi.mock` factory semantics in a way that breaks ~113 existing backend tests.
- **Frontend vitest.config.ts uses absolute paths**: The original `setupFiles: ['./src/test-setup.ts']` resolved relative to CWD, which broke when the config was loaded from root. Uses `path.resolve(__dirname, ...)` now so it works regardless of invocation directory.

## Specialist Feedback
(none yet)
