# PAN-415: Test: trace what calls complete-planning after agent finishes

## Status: Planning Complete

## Decision
This is a test issue to verify the complete-planning orchestration flow. The work agent should:
1. Create a file `test-trace.txt` in the workspace root
2. Delete it after confirming the trace works

## Scope
- **In scope:** Create and delete `test-trace.txt`
- **Out of scope:** Everything else — this is a test issue

## Approach
Single trivial task. Create the file, then remove it.

## Difficulty: trivial
- 0 real files modified (test artifact only)
- No risk
- No cross-cutting concerns
