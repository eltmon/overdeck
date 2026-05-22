---
name: bug-fix
description: Systematic approach to investigating and fixing bugs
---

# Bug Fix

When fixing a bug:

## 1. Reproduce
- Confirm the bug exists
- Document exact reproduction steps
- Identify affected code paths

## 2. Investigate Root Cause
- Use debugger or logging to trace execution
- Don't just fix symptoms - find the ROOT CAUSE
- Check for similar bugs elsewhere

## 3. Implement Fix
- Make minimal, focused changes
- Don't refactor unrelated code
- Commit: `fix: description (ISSUE-XXX)`

## 4. Add Regression Test
- Write a test that WOULD HAVE caught this bug
- Test should fail without fix, pass with it

## 5. Verify
- Run full test suite
- Manually verify the fix
- Check for unintended side effects
