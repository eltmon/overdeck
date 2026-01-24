---
name: code-review
description: Comprehensive code review covering correctness, security, performance
---

# Code Review

When reviewing code, examine these areas:

## Correctness
- Logic errors, off-by-one, null handling
- Edge cases and boundary conditions
- Race conditions in concurrent code

## Security
- Input validation gaps
- Injection vulnerabilities (SQL, XSS, command)
- Authentication/authorization bypasses
- Sensitive data exposure

## Performance
- O(n^2) where O(n) is possible
- N+1 query patterns
- Unnecessary allocations in hot paths
- Missing caching opportunities

## Design
- Clear abstractions and naming
- Single responsibility principle
- Appropriate coupling/cohesion

## Output Format
Provide findings as:
- **P0 (Critical)**: Must fix before merge
- **P1 (Major)**: Should fix before merge
- **P2 (Minor)**: Nice to fix
- **Observations**: Non-blocking notes
