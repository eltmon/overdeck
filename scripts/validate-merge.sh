#!/bin/bash
# validate-merge.sh - Validation script for merge completeness
# Checks for conflict markers, runs build, and runs tests
# Usage: validate-merge.sh [PROJECT_ROOT]
# Exit codes: 0 = validation passed, 1 = validation failed

set -e

PROJECT_ROOT="${1:-.}"
cd "$PROJECT_ROOT"

echo "=== Merge Validation ==="
echo "Project root: $(pwd)"
echo ""

# 1. Check for conflict markers
echo "Checking for conflict markers..."
CONFLICT_FOUND=false

# Check for <<<<<<< markers (at start of line only)
if git grep -l '^<<<<<<< ' 2>/dev/null; then
    echo "ERROR: Conflict start markers found in files:"
    git grep -l '^<<<<<<< '
    CONFLICT_FOUND=true
fi

# Check for ======= markers (at start of line)
if git grep -l '^=======$' 2>/dev/null; then
    echo "ERROR: Conflict separator markers found in files:"
    git grep -l '^=======$'
    CONFLICT_FOUND=true
fi

# Check for >>>>>>> markers (at start of line only)
if git grep -l '^>>>>>>> ' 2>/dev/null; then
    echo "ERROR: Conflict end markers found in files:"
    git grep -l '^>>>>>>> '
    CONFLICT_FOUND=true
fi

if [ "$CONFLICT_FOUND" = true ]; then
    echo ""
    echo "VALIDATION FAILED: Conflict markers detected"
    exit 1
fi

echo "✓ No conflict markers found"
echo ""

# 2. Run build
echo "Running build..."
if [ -f "package.json" ]; then
    if npm run build 2>&1; then
        echo "✓ Build passed"
    else
        echo ""
        echo "VALIDATION FAILED: Build errors detected"
        exit 1
    fi
elif [ -f "pom.xml" ]; then
    if mvn compile 2>&1; then
        echo "✓ Build passed"
    else
        echo ""
        echo "VALIDATION FAILED: Build errors detected"
        exit 1
    fi
else
    echo "⚠ No build system detected (no package.json or pom.xml), skipping build check"
fi
echo ""

# 3. Run tests
# BASELINE_FAILURES env var enables baseline comparison mode:
# If set, only fail when NEW failures appear (failures > baseline)
echo "Running tests..."
if [ -n "$BASELINE_FAILURES" ]; then
    echo "Baseline comparison mode: $BASELINE_FAILURES pre-existing failures"
fi

if [ -f "package.json" ]; then
    TEST_OUTPUT=$(npm test 2>&1) || true
    echo "$TEST_OUTPUT"

    # Check if tests passed cleanly
    if echo "$TEST_OUTPUT" | grep -q "Tests.*passed\|0 failed"; then
        echo "✓ Tests passed"
    elif [ -n "$BASELINE_FAILURES" ]; then
        # Baseline mode: extract failure count and compare
        # Match vitest output format: "X failed" or "X tests failed"
        ACTUAL_FAILURES=$(echo "$TEST_OUTPUT" | grep -oP '(\d+)\s+failed' | head -1 | grep -oP '\d+' || echo "0")
        if [ "$ACTUAL_FAILURES" -le "$BASELINE_FAILURES" ]; then
            echo ""
            echo "✓ Tests passed (baseline comparison: $ACTUAL_FAILURES failures <= $BASELINE_FAILURES baseline)"
        else
            echo ""
            echo "VALIDATION FAILED: New test failures detected ($ACTUAL_FAILURES > baseline $BASELINE_FAILURES)"
            exit 1
        fi
    else
        echo ""
        echo "VALIDATION FAILED: Test failures detected"
        exit 1
    fi
elif [ -f "pom.xml" ]; then
    if mvn test 2>&1; then
        echo "✓ Tests passed"
    else
        echo ""
        echo "VALIDATION FAILED: Test failures detected"
        exit 1
    fi
else
    echo "⚠ No test system detected, skipping test check"
fi
echo ""

echo "=== VALIDATION PASSED ==="
exit 0
