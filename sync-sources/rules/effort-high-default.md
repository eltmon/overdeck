---
scope: universal
---
### Reasoning effort defaults to `high` — never default to `xhigh` or `max`

The ideal reasoning-effort tier is **`high`** for every model, including
frontier models (Fable, Opus). `xhigh` and `max` multiply token cost with
almost no extra ROI, so they must never be a default anywhere — not in
config files, role definitions, hardcoded code fallbacks, UI pickers, or
spawn flags.

When configuring or spawning agents, conversations, or roles: leave effort
unset (inherits the `high` default) or set `high` explicitly. Use `xhigh`/
`max` only when the operator explicitly chooses it for a specific task —
it is their cost call, never yours. If you find a default set to `xhigh`/
`max`, treat it as a bug: lower it to `high` and note the change.
