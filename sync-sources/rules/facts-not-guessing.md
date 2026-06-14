---
scope: dev
---
### Answer system-state questions with verified facts

When asked about permissions, flags reaching a harness, why an agent behaves a
way, or any other system-state question, verify the actual state before
answering. Ground claims in `git grep`, resolved config values, `/proc/<pid>/cmdline`,
`strings`, logs, or the live command output.

Separate code behavior, resolved configuration, and already-running process
state. A live process keeps its launch-time flags after a config change, so
"the config says X" is not proof that the running process has X.
