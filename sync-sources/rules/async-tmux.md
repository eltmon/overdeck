---
scope: dev
paths:
  - "src/dashboard/**"
  - "src/lib/agents.ts"
  - "src/lib/cloister/**"
  - "src/lib/runtimes/**"
---
Use `sendKeysAsync()` from `src/lib/tmux.ts` — never `sendKeys()` (sync).

For tmux message delivery, use the `load-buffer` + `paste-buffer` pattern:
1. Write text to temp file
2. `tmux load-buffer <file>`
3. `tmux paste-buffer -t <session>`
4. Wait 300ms (let text render)
5. `tmux send-keys -t <session> C-m` (Enter)

Raw `tmux send-keys "text"` followed immediately by `C-m` is unreliable — Enter arrives before text is processed.
