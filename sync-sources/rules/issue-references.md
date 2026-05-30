---
scope: universal
---
### Issue references in chat

When referencing a tracker issue or PR in chat responses (e.g. `PAN-1564`, `MIN-663`, `AUR-12`, `KRUX-3`, `#1430`), **render it as a clickable markdown link** so the user can open it directly. The user works across many issues and wants one-click navigation; a bare `PAN-1564` forces a manual lookup.

Use link text = issue ID, target = the tracker URL:

```markdown
[PAN-1564](https://github.com/eltmon/panopticon-cli/issues/1564)
```

**Prefix → tracker URL:**

| Prefix | Tracker | How to build the URL |
| --- | --- | --- |
| `PAN-<n>` | GitHub (eltmon/panopticon-cli) | `https://github.com/eltmon/panopticon-cli/issues/<n>` — `PAN-<n>` **is** GitHub issue `#<n>` |
| `KRUX-<n>` | GitHub (eltmon/krux) | `https://github.com/eltmon/krux/issues/<n>` |
| `MIN-<n>` | Linear (Mind Your Now) | Use the issue's canonical `url` from the tracker API (`https://linear.app/<workspace>/issue/MIN-<n>`). When unsure of the exact URL, fetch it rather than guessing the workspace slug. |
| `AUR-<n>` | Linear (Auricle) | Same as MIN — use the canonical `url` from the tracker API. |

PRs follow the same rule: `#1430` → `[#1430](https://github.com/eltmon/panopticon-cli/pull/1430)`.

**When to apply:** any time an issue/PR ID appears as something the user might want to open — lists, audits, status reports, recommendations, "I filed X". Bare IDs are fine only inside code blocks, commit messages, PR bodies, or other file content (GitHub auto-links `#1564` there anyway).
