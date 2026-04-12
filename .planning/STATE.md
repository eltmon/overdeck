# PAN-645: Tests: root Vitest config does not discover ActionsSection.test.tsx

## Status: Implementation Complete

## Current Phase
Closing final bead (mtq) after committing jm3 script simplification.

## Completed Work
- [x] feature-pan-489-0ra: Verified discovery works; full suite 2847 passed (no commit, verification bead)
- [x] feature-pan-489-jm3: Simplified npm test script to single vitest invocation (commit pending)
- [x] feature-pan-489-mtq: Created vitest.workspace.ts + vitest 1.x→2.x upgrade + frontend abs paths (commit 31c03059)

## Remaining Work
- [ ] Commit jm3, close jm3 + mtq, push, pan work done

## Key Decisions
- **Vitest 2.x instead of 1.x**: 1.6.1 has a bug where workspace mode fails with "Cannot read properties of undefined (reading 'config')" at `describe`. 2.1.9 fixes this. Did not upgrade to 4.x because v4 changed `vi.mock` factory semantics in a way that breaks ~113 existing backend tests.
- **Frontend vitest.config.ts uses absolute paths**: Original `./src/test-setup.ts` resolved relative to CWD, breaking when loaded from root. Now uses `path.resolve(__dirname, ...)`.

## Specialist Feedback
(none yet)
- **[2026-04-12T14:35Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-12T14:36Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-12T14:36Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
- **[2026-04-12T14:39Z] verification-gate → FAILED** — `.planning/feedback/004-verification-gate-failed.md`
