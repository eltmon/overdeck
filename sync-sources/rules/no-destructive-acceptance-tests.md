---
scope: dev
---
### Never write destructive recovery "acceptance tests"

Never codify a destructive recovery "test" — e.g. "`rm -rf ~/.overdeck`,
lose nothing" — in docs, READMEs, runbooks, or code comments.

It is a footgun: someone will execute the "test" expecting magic recovery and
actually lose data. State the cache-derivability principle as a property the
system maintains ("the database holds nothing not derivable from git +
GitHub"), never as an imperative "delete X and observe" instruction.
