# PAN-93: Merge-agent should detect and resolve merge conflicts before completing

## Status: PLANNING COMPLETE

## Problem Statement

When merging PAN-75, the merge-agent left unresolved merge conflicts in files, causing build failures:
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `.planning/STATE.md`

The build failed with conflict markers (`<<<<<<< HEAD`) still in the code.

**Root cause:** The polling loop in `spawnMergeAgentForBranches()` only checks:
- Did HEAD change?
- Is commit message merge-like?
- Is it pushed?

It does NOT validate:
- Conflict markers removed
- Build passes
- Tests pass

## Solution Architecture

### Two-Layer Validation (Belt + Suspenders)

```
┌─────────────────────────────────────────────────────────────┐
│                    Merge Request                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Pre-Merge Validation (Subagent - Haiku)          │
│  • Check workspace has no existing conflict markers         │
│  • Verify workspace builds/tests before attempting merge    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Merge Execution (Merge-Agent Specialist - Opus)           │
│  • git merge                                                │
│  • Resolve conflicts if any                                 │
│  • Call validation subagent                                 │
│  • Push if valid                                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Post-Merge Validation (Subagent - Haiku)         │
│  • Run scripts/validate-merge.sh                            │
│  • Check for conflict markers (all tracked files)           │
│  • Run build                                                 │
│  • Run tests                                                 │
│  • Report pass/fail to merge-agent                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Polling Fallback (Pure Bash - No AI)             │
│  • If specialist doesn't report, polling catches merge      │
│  • Run same validation script                               │
│  • Auto-revert if validation fails                          │
└─────────────────────────────────────────────────────────────┘
```

### On Validation Failure

1. **Auto-revert**: `git reset --hard HEAD~1`
2. **Report**: Return structured failure with:
   - Which files have conflict markers
   - Build errors (if applicable)
   - Test failures (if applicable)
3. **Leave clean state**: Repository is back to pre-merge state

## Decisions Made

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Validation level | Strict (conflicts + build + tests) | Prevent any broken code from reaching main |
| Execution model | Subagent (Haiku) | Preserve Opus context for merge decisions |
| Command format | Shell script `scripts/validate-merge.sh` | Per-project customizable, simple to maintain |
| Validation layers | Both specialist + polling fallback | Redundancy catches edge cases |
| Failure handling | Auto-revert + report | Clean state for retry |
| Pre-merge check | Yes | Catch issues before merge complicates things |
| File types | All tracked files | Conflict markers can appear anywhere |
| Testing | Unit + integration tests | High-stakes feature needs thorough testing |

## Implementation Details

### New Files

1. **`scripts/validate-merge.sh`** - Main validation script
   ```bash
   #!/bin/bash
   # Check for conflict markers in tracked files
   # Run npm run build
   # Run npm test
   # Exit 0 on success, 1 on failure with details
   ```

2. **`src/lib/cloister/validation-subagent.ts`** - Subagent spawning logic
   - Spawns Haiku subagent to run validation
   - Parses results
   - Returns structured pass/fail

3. **`tests/unit/lib/merge-validation.test.ts`** - Unit tests
   - Test conflict marker detection regex
   - Test result parsing

4. **`tests/integration/merge-validation.test.ts`** - Integration tests
   - Mock merge with conflicts scenario
   - Verify auto-revert works
   - Verify clean merge passes

### Modified Files

1. **`src/lib/cloister/merge-agent.ts`**
   - Add validation call after detecting merge completion
   - Add auto-revert logic on validation failure
   - Update `MergeResult` interface with validation details

2. **`src/lib/cloister/prompts/merge-agent.md`**
   - Add explicit instruction to run validation script
   - Emphasize not committing with conflict markers
   - Add validation result markers

3. **`src/dashboard/server/index.ts`**
   - Update merge endpoint to handle validation failures
   - Return detailed error info to frontend

### Validation Script Details

```bash
#!/bin/bash
# scripts/validate-merge.sh

set -e

PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"

echo "=== Merge Validation ==="

# 1. Check for conflict markers
echo "Checking for conflict markers..."
if git grep -l '<<<<<<< ' 2>/dev/null; then
    echo "ERROR: Conflict markers found in files:"
    git grep -l '<<<<<<< '
    exit 1
fi

# Also check for ======= and >>>>>>> patterns
if git grep -l '^=======$' 2>/dev/null; then
    echo "ERROR: Conflict separator markers found"
    exit 1
fi

if git grep -l '>>>>>>> ' 2>/dev/null; then
    echo "ERROR: Conflict end markers found"
    exit 1
fi

echo "No conflict markers found."

# 2. Run build
echo "Running build..."
if [ -f "package.json" ]; then
    npm run build || { echo "ERROR: Build failed"; exit 1; }
elif [ -f "pom.xml" ]; then
    mvn compile || { echo "ERROR: Build failed"; exit 1; }
fi
echo "Build passed."

# 3. Run tests
echo "Running tests..."
if [ -f "package.json" ]; then
    npm test || { echo "ERROR: Tests failed"; exit 1; }
elif [ -f "pom.xml" ]; then
    mvn test || { echo "ERROR: Tests failed"; exit 1; }
fi
echo "Tests passed."

echo "=== Validation PASSED ==="
exit 0
```

## Out of Scope

- Changing the merge strategy itself (squash vs regular)
- Changing the specialist system architecture
- Adding new specialist types
- UI changes for validation status display

## Success Criteria

1. Merge with unresolved conflicts is detected and rejected
2. Failed build after merge is detected and rejected
3. Failed tests after merge is detected and rejected
4. Auto-revert leaves repository in clean state
5. Detailed failure report helps debugging
6. Tests cover conflict detection and revert logic

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Validation adds latency | Medium | Low | Subagent runs in parallel, validation script is fast |
| False positives (e.g., doc with `<<<<` example) | Low | Medium | Use proper git grep, could add allowlist |
| Revert leaves orphaned state | Low | High | Verify revert works in tests, add state cleanup |

## Test Plan

### Unit Tests
- `parseConflictMarkers()` - detect markers in various formats
- `validateMergeResult()` - parse validation script output
- `shouldAutoRevert()` - decision logic

### Integration Tests
- Scenario: Clean merge, validation passes
- Scenario: Merge with unresolved conflicts, auto-reverts
- Scenario: Merge succeeds but build fails, auto-reverts
- Scenario: Merge succeeds but tests fail, auto-reverts
- Scenario: Validation script missing, graceful degradation
