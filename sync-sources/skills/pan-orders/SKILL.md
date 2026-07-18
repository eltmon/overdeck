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
pan orders start <id>
```

- `create` makes a draft book with a date-and-name id.
- `add` defaults to Lane A. `--after` must name an item already in the target lane. `--reverify` requires PRD re-verification before pickup.
- `move` accepts `--lane <A|B>`, `--order <n>`, or both.
- `start` validates and starts the same orders-bound path as Flywheel start; validation blocks leave the book unchanged.

Order-book reads and mutations go through the canonical resolver and writer. Do not edit `orders/*.json` directly.
