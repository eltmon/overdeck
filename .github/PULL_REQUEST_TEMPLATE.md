## Verification

- [ ] Typecheck, lint, focused tests, and the full test suite pass.
- [ ] No-loss audits for changed operator surfaces pass.

## Change size

Record the exact additions, deletions, and net line count with:

```bash
git diff --numstat origin/main...HEAD | awk '{ added += $1; deleted += $2 } END { printf "added=%d deleted=%d net=%+d\n", added, deleted, added - deleted }'
```
