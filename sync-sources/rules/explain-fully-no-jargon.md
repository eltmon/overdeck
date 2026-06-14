---
scope: dev
---
### Operator-facing pipeline messages must stand alone

Operator-facing messages must define pipeline terms on first use and state the
consequence in complete sentences. Terms like `ready=1`, verification gate,
merge queue, and advancing slot need enough inline context that the operator can
act without opening another doc.

Do not compress operator-facing output to save tokens, even at high context
usage. Durable docs may be terse; live operator messages must be clear.
