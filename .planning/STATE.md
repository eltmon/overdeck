# PAN-594: stale session_file paths with incorrect CWD encoding

## Status: Implementation Complete

## Current Phase
Implementation complete — schema migration added, lint passing.

## Completed Work
- [x] feature-pan-489-lo3: Add v13→v14 schema migration to fix stale session_file paths (commit: 030d07bd)
  - Bumped SCHEMA_VERSION from 13 to 14
  - Added encodeClaudeProjectDir import from paths.js
  - Added migration block that extracts CWD segment, re-encodes with correct function, verifies file exists, and updates DB

## Remaining Work
- None

## Key Decisions
- Migration uses existsSync check before updating — skips if correctly-encoded file doesn't exist (file may be truly missing, not just stale path)
- Does not filter by archived_at — archived conversations with stale paths are also fixed

## Specialist Feedback
