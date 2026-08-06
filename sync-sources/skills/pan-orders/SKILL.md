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
pan orders add <id> <issue...> --lane B --after <issue> --reverify
pan orders remove <id> <issue>
pan orders move <id> <issue> --lane A --order 2
pan orders queue <id>
pan orders start <id>
pan orders list --project <key>
```

- `create` makes a draft book with a date-and-name id.
- `add` defaults to Lane A. `--after` must name an item already in the target lane. `--reverify` requires PRD re-verification before pickup.
- `move` accepts `--lane <A|B>`, `--order <n>`, or both.
- `queue` marks a draft book ready for dispatch, so the Flywheel can pick it up from the ready queue. A book that is not a draft exits non-zero with `must be draft before it can be queued`.
- `start` validates and starts the same orders-bound path as Flywheel start; validation blocks leave the book unchanged.
- Every verb accepts `--project <key>` to resolve the order book in another registered project instead of the current directory's project. Omit it to keep resolving from cwd, as before. An unregistered key exits non-zero with `Unknown project: <key>`.

Order-book reads and mutations go through the canonical resolver and writer. Do not edit `orders/*.json` directly.
