---
name: feature-work
description: Standard workflow for implementing new features with testing
---

# Feature Work

When implementing a new feature:

## 1. Understand Requirements
- Read the Linear/GitHub issue thoroughly
- Check for associated PRD in `docs/prds/`
- Identify acceptance criteria
- Clarify ambiguities BEFORE coding

## 2. Design Approach
- Identify files that need changes
- Consider existing patterns in codebase
- Plan implementation (don't gold-plate)

## 3. Implement
- Follow existing code conventions
- Make atomic, focused commits
- Keep changes scoped to the issue
- Commit format: `feat: description (ISSUE-XXX)`

## 4. Test
- Add tests for new functionality
- Run full test suite
- All tests must pass before proceeding

## 5. Self-Review
- Review your diff: `git diff origin/main...HEAD`
- Check for: bugs, security issues, style, cruft
- Fix issues found (don't just note them)

## 6. Submit
- Push branch: `git push -u origin $(git branch --show-current)`
- Create MR/PR with clear description
