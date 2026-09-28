---
scope: universal
---
### Spell out literal paths in delete commands — no variables

Never put a shell variable in the target of `rm`, `rm -rf`, or `find … -delete`. Write the exact path, or a glob with the directory spelled out (`rm -f /abs/dir/*.png`, not `rm -f $DIR/*.png`).

**Why:** a variable hides what gets deleted when the operator approves the command, and an unset variable turns the target into `/*.png`.
