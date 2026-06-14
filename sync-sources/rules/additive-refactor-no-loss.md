---
scope: dev
---
### Refactor existing surfaces with an explicit no-loss audit

Refactor plans for an existing surface must be additive or a deliberate
superset, never a silent replacement. Enumerate what the old surface exposes,
then verify every old command, action, status, route, view, and affordance has a
home in the new surface.

Any deletion or replacement needs a no-loss audit gate, usually a focused test,
that blocks until every old item is accounted for. "Is anything lost?" is
answered by the audit, not by reasoning from memory.
