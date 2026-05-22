---
name: refactor
description: Safe refactoring approach with test coverage first
---

# Refactoring

When refactoring code:

## Before Starting
1. Ensure tests exist for code being refactored
2. Run tests to establish baseline (must pass)
3. If test coverage is low, ADD TESTS FIRST

## During Refactoring
- Make ONE type of change at a time
- Keep tests green after EACH change
- Commit frequently with clear messages

## Refactoring Types
- **Extract**: Pull code into new function/class
- **Inline**: Remove unnecessary indirection
- **Rename**: Improve naming clarity
- **Move**: Relocate to better home
- **Simplify**: Reduce complexity

## After Refactoring
- All tests must still pass
- Behavior must be unchanged
- Review diff for unintended changes
