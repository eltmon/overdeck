---
scope: dev
---
### Verify dashboard and terminal rendering yourself

Do not ask the operator to eyeball dashboard, browser, or terminal rendering.
Use Playwright screenshots for browser UI and inspect the PNG yourself. For
terminal ANSI output, capture the pane with `tmux -L panopticon capture-pane -t <session> -e -p`.

Preview terminal experiments in a throwaway `panopticon`-socket session. Do not
attach to and resize a live agent session just to inspect rendering.
