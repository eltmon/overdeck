---
scope: dev
---
### Never hardcode a model fallback

Model resolution must never fall through to a hardcoded model ID. The
default/fallback model must always come from an explicit setting that
justifies it.

A hardcoded fallback silently runs a model the operator never chose. An
unset default must fail loudly with a clear "no default configured" error —
never silently pick a code literal. A role with a configured `roles.<role>.model`
must resolve to it or error, never fall through to a conversation default.
