---
scope: dev
paths:
  - "src/lib/tmux.ts"
---
### Prefer async tmux primitives — sync versions are legacy debt

`src/lib/tmux.ts` contains both sync (`sendKeys`) and async (`sendKeysAsync`) versions. The sync versions are legacy debt — do not add new sync functions or callers.

Any new tmux interaction must use the async variants. Server-reachable code must ONLY use `sendKeysAsync`.
