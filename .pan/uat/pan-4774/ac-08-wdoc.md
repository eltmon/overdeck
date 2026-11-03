# PAN-4774 — AC-8: the W-DOC deliverables (pan-2350.md, W-DOC)

- **Commit tested:** `feature/pan-4774` at the commit that adds this file (integrated main plus this issue's changes).
- **Date:** 2026-11-02.
- **Method:** each file checked for existence and for the topics W-DOC names (`grep`), `docs.json` navigation read, supersede headers read from the first five lines of each draft, and every "planned" label in `anywhere.mdx` checked against its issue's state (`gh issue view`). `npm run lint:docs` → "docs lint passed (86 docs files, 73 published pages)" after the fixes.

| Deliverable | Result | Evidence |
| --- | --- | --- |
| `configuration/linked-machines.mdx` (linking, encryption, routes, sharing, title-bar states, remote control, Pull here, delegation, Fly) | present | 633 lines; sections include remote control (`pan tell @<machine>/<conv>`, line 368), **Pull here** (line 372), Fly machines and "Work agents on Fly" (line 190) |
| `configuration/remote-access.mdx` as the reach page | present | 426 lines |
| `configuration/tailscale.mdx` | present | 155 lines |
| `cli/machines.mdx` with `pan connect`, `pan machines forward`, `--machine auto`, `--needs`, `pan tell @<label>/<conv>` | **fixed** | `pan connect` 10 mentions, `machines forward` 4, `--machine auto` 4, `--needs` 3; `pan tell @` had **0**. Added the section "Messaging a conversation on another machine: `pan tell @<label>/<conv>`", linking to the full `pan tell` reference in `cli/agent-commands.mdx` |
| `configuration/triggers.mdx` | present | 238 lines |
| `cli/account.mdx` in `docs.json` next to `cli/pair` | present | `docs.json` lists `cli/pair`, `cli/tailscale`, `cli/account` in the same group (lines 69–71) |
| `configuration/push-notifications.mdx` in `docs.json` next to `configuration/remote-access` | present | same Anywhere group as `configuration/remote-access` (lines 61 and 67) |
| `configuration/mcp.mdx` | present | 171 lines |
| `reference/lanes.mdx` documents `--machine` | present | 5 mentions of `--machine` |
| `anywhere.mdx` "What has shipped" corrected, no "planned" label on a shipped feature | **fixed** | The "Fly VMs as machines" step said "Still planned: Fly work agents as linked conversations on the VM's server (PAN-4734)"; PAN-4734 is closed as completed, so the step now lists it as shipped (`pan start <id> --remote`, link to "Work agents on Fly"). The other "planned" labels name open work and stay: hosted vault and `pan vault migrate`, billing, shared sessions, PAN-1676 (open), the Hermes bridge PAN-2353 (open), hosted agent capacity PAN-4298 (open). No "planned PAN-4446" line remains. |
| `docs/ANYWHERE-ARCHITECTURE.md` | present | 1,130 lines |
| CLAUDE.md topic-index row for it | present | one row links `docs/ANYWHERE-ARCHITECTURE.md` |
| "Superseded by `pan-2350.md`" header on `pan-2352.md`, `pan-2355.md`, `pan-2356.md`, `pan-3513.md` | present | the header appears in the first five lines of all four |

Note: the "What has shipped" table keeps its v0.64.0 and v0.65.0 rows; `v0.65.0` is a real tag, and the rows describe what those releases shipped, so they are not stale.

Status: passed
