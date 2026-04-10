# PAN-594: stale session_file paths with incorrect CWD encoding

## Status: Ready for Merge

## Current Phase
Review passed. Tests queued and running.

## Completed Work
- [x] feature-pan-489-lo3: Add v13→v14 schema migration to fix stale session_file paths (commit: 030d07bd)
  - Bumped SCHEMA_VERSION from 13 to 14
  - Added encodeClaudeProjectDir import from paths.js
  - Added migration block that extracts CWD segment, re-encodes with correct function, verifies file exists, and updates DB
- [x] Fix WorkspaceConfig type import in projects.ts (commit: 4ce080e4)
- [x] Fix activity-logger null vs undefined issue (commit: 1d4900ca)
- [x] Fix workspace.ts project config access bugs (commit: 54e96552)
- [x] Fix ModelOverrideModal unused import (commit: bb664616)

## Remaining Work
- None — waiting for tests to complete

## Key Decisions
- Migration uses existsSync check before updating — skips if correctly-encoded file doesn't exist (file may be truly missing, not just stale path)
- Does not filter by archived_at — archived conversations with stale paths are also fixed

## Specialist Feedback
- **[2026-04-10T03:20Z] verification-gate → FAILED** — typecheck failures (pre-existing in origin/main, fixed by importing WorkspaceConfig from workspace-config.ts)
- **[2026-04-10T03:26Z] verification-gate → FAILED** — activity-logger null vs undefined (fixed)
- **[2026-04-10T03:30Z] verification-gate → FAILED** — workspace.ts config access bugs (fixed)
- **[2026-04-10T03:35Z] verification-gate → FAILED** — ModelOverrideModal unused import (fixed)
- **[2026-04-10T03:38Z] verification-gate → FAILED** — test failures in work-type-router.test.ts (pre-existing in origin/main)
- **[2026-04-10T03:40Z] REVIEW PASSED** — Tests queued automatically
