# Batch Operations

`bd batch` runs multiple write operations in a single Dolt transaction.

## When to Use Batch

- **Bulk-close beads** — Close all beads for an issue atomically
- **Bulk-update** — Update status/priority on multiple beads at once
- **Atomic operations** — All succeed or all roll back
- **Performance** — One DOLT_COMMIT instead of N separate commits

## Syntax

Commands are read from stdin (one per line) or from a file via `-f/--file`.

```bash
# From a pipe
bd list --status stale -q | awk '{print "close",$1,"stale"}' | bd batch

# From a file
bd batch -f operations.txt

# Inline
printf 'close bd-1 done\nupdate bd-2 status=in_progress\n' | bd batch
```

## Supported Commands

```
close <id> [reason...]
update <id> <key>=<value> [<key>=<value> ...]
create <type> <priority> <title...>
dep add <from-id> <to-id> [type]
dep remove <from-id> <to-id>
```

**Supported update keys**: `status`, `priority`, `title`, `assignee`
**Supported dependency types**: See `bd dep add --help` (default: `blocks`)

## Grammar Rules

- One command per line
- Blank lines and `# ...` comments are ignored
- Tokens are whitespace-separated
- Use double quotes for strings containing spaces: `"like this"`
- Use `\\` for backslash and `\\"` for embedded quotes

## Example: Bulk Close

```bash
# Close all open beads for PAN-116
cat <<'EOF' | bd batch
close pan-abc "Implementation complete"
close pan-def "Tests passing"
close pan-ghi "Documentation updated"
EOF
```

## Example: Bulk Update

```bash
# Deprioritize multiple beads
cat <<'EOF' | bd batch
update pan-abc priority=3
update pan-def priority=3
update pan-ghi priority=3
EOF
```

## Flags

| Flag | Description |
|------|-------------|
| `-f, --file` | Read commands from file instead of stdin |
| `--dry-run` | Parse input and echo commands without executing |
| `-m, --message` | Custom DOLT_COMMIT message |
| `--json` | Output results as JSON |

## Error Handling

On any error, the **entire transaction is rolled back** and `bd batch` exits non-zero with the failing line. This guarantees atomicity — either all operations apply or none do.

## Limitations

- Read commands (`show`, `list`, `ready`) are NOT supported
- Complex `create` flows with many flags are NOT supported
- Use normal `bd` subcommands for interactive/read operations
