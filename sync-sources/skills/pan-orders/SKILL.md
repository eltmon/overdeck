---
name: pan-orders
description: "pan orders — create, inspect, edit, and start Flywheel order books"
triggers:
  - pan orders
  - order book
  - special orders
allowed-tools:
  - Bash
  - Read
---

# pan orders

Use `pan orders` to manage the operator-owned order book that scopes a Flywheel campaign.

```bash
pan orders create "Campaign name"
pan orders list
pan orders show <id>
pan orders add <id> <issue...>
pan orders add <id> <issue...> --lane B --after <issue> --reverify --prereqs <issue> --plan-at-pickup
pan orders remove <id> <issue>
pan orders move <id> <issue> --lane A --order 2
pan orders rename <id> <name>
pan orders set <id> --parallel <1-8>
pan orders set <id> --brief <path.md>
pan orders pause <id> --reason <text>
pan orders resume <id> --reason <text>
pan orders item <id> <issue> --prereqs <issue> --reverify --plan-at-pickup
pan orders queue <id>
pan orders unqueue <id>
pan orders archive <id>
pan orders unarchive <id>
pan orders start <id>
pan orders preview <id>
pan orders candidates --limit <1-100>
pan orders check <id>
pan orders list --project <key>
pan orders list --json
```

- `create` makes a draft book with a date-and-name id.
- `add` defaults to Lane A. `--after` must name an item already in the target lane. `--reverify` requires PRD re-verification before pickup. `--prereqs <issues>` (comma-separated) and `--plan-at-pickup` set the new item's requirements.
- `move` accepts `--lane <A|B>`, `--order <n>`, or both.
- `rename` changes the book's name.
- `set` changes `--parallel <n>` (1 to 8) or `--brief <path>` (a `.md` path; `--no-brief` clears it). One of them is required.
- `pause` and `resume` change pickup posture; `--reason <text>` is optional.
- `item` changes one issue's `--prereqs`, `--reverify`/`--no-reverify` or `--plan-at-pickup`/`--no-plan-at-pickup`. At least one flag is required.
- `queue` marks a draft book ready for dispatch, so the Flywheel can pick it up from the ready queue. A book that is not a draft exits non-zero with `must be draft before it can be queued`.
- `list` shows each book's phase: `active` (the book the Flywheel works from: the first ready book in queue order), `queued #<n>`, `draft` or `archived`, with ` (finished)` when every issue has landed or is parked. A finished book keeps the active slot until it is archived.
- `unqueue` moves a queued (ready) book back to draft. Any other status exits non-zero with `must be queued before it can be moved back to draft`.
- `archive` moves a draft or queued book to complete and frees its issues to join another book. An archived book exits non-zero with `must be draft or queued before it can be archived`.
- `unarchive` restores an archived book as a draft. It exits non-zero with `must be archived before it can be restored` for a book that is not archived, and with `cannot be restored: <ISSUE> already belongs to order book <otherId>` when one of its issues now sits in another book that is not archived.
- `start` validates and starts the same orders-bound path as the Flywheel loop; validation blocks leave the book unchanged.
- `preview` prints the brief the Flywheel receives for the book.
- `candidates` lists the top backlog issues that are in no order book (`--limit`, 1 to 100, default 10).
- `check <id>` prints the blocking problems and warnings through the running dashboard; start it with `pan up` first.
- `list` and `show` accept `--json` to print the raw order book(s).
- Every verb accepts `--project <key>` to resolve the order book in another registered project instead of the current directory's project. Omit it to keep resolving from cwd, as before. An unregistered key exits non-zero with `Unknown project: <key>`.

Order-book reads and mutations go through the canonical resolver and writer. Do not edit `.pan/orders/*.json` directly.
