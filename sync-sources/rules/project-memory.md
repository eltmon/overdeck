---
scope: universal
---
### Record durable facts with `pan memory add`, never in harness-native memory

A durable fact (an operator correction, a working agreement, a non-obvious project truth) goes in the
repo: `pan memory add <id> --type feedback|project|reference --description "<one line>" --body
"<fact, then **Why:** and **How to apply:**>"`. Operator-level facts: add `--user` (synced to your other machines); facts true on one machine only
(local paths, hardware): `--machine`. Facts reach every
harness's next session through the Project memory index. Never write `~/.claude/projects/*/memory/` or
any other harness-native memory in a managed session.
