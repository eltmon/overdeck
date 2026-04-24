# Rules Audit and Compact

`bd rules` scans `.claude/rules/` for contradictions and merge opportunities.

## When to Use

- **Before `pan sync`** — Catch conflicting agent instructions
- **After adding new rules** — Verify no contradictions introduced
- **Periodic cleanup** — Merge related rules into composites

## Commands

### `bd rules audit`

Scan rules for contradictions and merge opportunities.

```bash
bd rules audit                    # Default scan
bd rules audit --threshold 0.8    # Stricter matching (default: 0.6)
bd rules audit --path ./rules     # Custom rules directory
bd rules audit --json             # Machine-readable output
```

**What it checks:**
- Contradictory instructions (e.g., "use `bd claim`" vs "use `bd update --claim`")
- Duplicate rules with slightly different wording
- Rules that could be merged into composites

### `bd rules compact`

Merge related rules into composites.

```bash
bd rules compact --dry-run        # Preview merges without applying
bd rules compact --auto           # Auto-merge related rules
bd rules compact --group similar  # Group by similarity
bd rules compact --path ./rules   # Custom rules directory
```

**What it does:**
- Identifies semantically related rules
- Suggests composite rules that cover multiple cases
- Reduces rule file count and maintenance overhead

## Example Output

```bash
$ bd rules audit
Scanning .claude/rules/...

⚠ Contradiction detected:
  Rule A (dashboard-node22-only.md): "NEVER use bun run for dashboard"
  Rule B (old-dev-guide.md): "Use bun run for faster dev server"
  
💡 Merge opportunity:
  Rule C (beads-claim.md): "Use bd update --claim"
  Rule D (beads-claim-wrong.md): "Use bd claim"
  → These should be consolidated

Summary: 2 contradictions, 3 merge opportunities
```

## Panopticon Integration

Add to `pan sync` or pre-flight checks:

```bash
# In pan sync workflow
bd rules audit --json || echo "Rule conflicts detected — review before continuing"
```

## Best Practices

1. **Run audit before committing rule changes**
2. **Review compact suggestions before applying** — use `--dry-run` first
3. **Set threshold based on rule similarity** — lower = more suggestions, higher = stricter matching
4. **Fix contradictions immediately** — conflicting rules cause agent confusion and wasted tokens
