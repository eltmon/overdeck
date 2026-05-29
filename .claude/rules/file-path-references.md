---
scope: universal
---
### File path references in chat

When referencing files in chat responses, **always use absolute paths** (e.g. `/home/user/Projects/repo/src/foo.ts`) so they render as clickable links in IDEs like Cursor. Relative paths in backticks (e.g. `` `src/foo.ts` ``) are **not clickable** and force the user to copy and resolve the path manually.

For pointing at a specific location, use the `file_path:line_number` form (e.g. `/home/user/Projects/repo/src/foo.ts:42`). The IDE opens the file at that line on click.

**Prefer the explicit markdown-link form when handing a path back to the user**, because IDE auto-detection of bare paths is unreliable (it can miss paths with `-` chars or paths inside code blocks). Wrap the path in backticks inside the link text so it stays monospaced *and* clickable:

```markdown
[`/home/user/Projects/repo/src/foo.ts`](/home/user/Projects/repo/src/foo.ts)
```

Same pattern for `file_path:line_number`. Use the markdown-link form when the path is the deliverable of the message ("here's the file"); a bare absolute path is still fine for inline mentions inside prose.

This applies to user-facing text only — paths inside file content (commit messages, docs, code) follow whatever convention that artifact already uses.
