---
scope: universal
---
### File path references in chat

When referencing files in chat responses, **always use absolute paths** (e.g. `/home/user/Projects/repo/src/foo.ts`) so they render as clickable links in IDEs like Cursor. Relative paths in backticks (e.g. `` `src/foo.ts` ``) are **not clickable** and force the user to copy and resolve the path manually.

Link to the absolute file path **without a line or column suffix or fragment**. Some chat-to-editor openers treat `:42` as part of the filename and open an empty buffer instead of the existing file. Put location information outside the link: `[foo.ts](/home/user/Projects/repo/src/foo.ts), line 42`.

**Prefer the explicit markdown-link form when handing a path back to the user**, because IDE auto-detection of bare paths is unreliable (it can miss paths with `-` chars or paths inside code blocks). Use plain link text without backticks:

```markdown
[foo.ts](/home/user/Projects/repo/src/foo.ts), line 42
```

Use the markdown-link form when the path is the deliverable of the message ("here's the file"); a bare absolute path is still fine for inline mentions inside prose. Keep line and column numbers outside bare paths too. For paths containing spaces, wrap the link target in angle brackets: `[My File.ts](</home/user/My Project/My File.ts>), line 42`.

This applies to user-facing text only — paths inside file content (commit messages, docs, code) follow whatever convention that artifact already uses.
