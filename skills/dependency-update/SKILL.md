---
name: dependency-update
description: Safe approach to updating dependencies
---

# Dependency Update

## 1. Audit Current State
```bash
npm outdated          # See what's outdated
npm audit             # Check for vulnerabilities
```

## 2. Update Strategy
- **Patch versions**: Usually safe, batch update
- **Minor versions**: Update one at a time, test
- **Major versions**: Update individually, read changelog

## 3. For Each Update
```bash
npm install package@version
npm test
# If tests pass, commit
# If tests fail, investigate or rollback
```

## 4. Verify
- Run full test suite
- Smoke test critical paths
- Check bundle size (for frontend)
