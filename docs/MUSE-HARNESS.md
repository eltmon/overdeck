# Muse Code integration

The canonical harness ID is `muse`; the provider ID is `meta`. Only
`muse-spark-1.3` and `muse-spark-1.3-contributor` route to this harness.
Neither model is selected as an implicit fallback. Contributor is an explicit
choice because its discounted price requires contributing training data.

## Launch and context

The launcher runs the persistent native TUI with an explicit model, workspace,
and reasoning effort. It uses the existing PTY supervisor and async message
delivery door. It never invokes `muse exec` or adds `--yolo`. Native approval
prompts remain available in the terminal.

Muse Code 1.0.2 accepts `TBH_EVAL_APPEND_DEVELOPER_PROMPT_FILE`. Overdeck writes
its global, project, workspace, and role context to the agent-owned
`muse-context.md` and passes this file as developer input. This version-specific
interface was checked against the installed binary and an offline echo run;
recheck it when upgrading Muse. Native instruction files are not rewritten. Muse also discovers the shared
`~/.agents/skills` and `~/.claude/skills` catalogs populated by `pan sync`.

## Session and transcript ownership

`XDG_DATA_HOME` points to `<overdeck-home>/agents/<agent-id>/muse-data`.
The canonical Muse session resolver in `src/lib/runtimes/muse-session.ts`
reads root logs at `muse/sessions/YYYY/MM/DD/<uuid>/session.jsonl`. It excludes
nested subagent logs and chooses the newest root UUIDv7 by creation order.
Resume passes that native UUID, never the generic Claude session identity.
Muse's native configuration and credentials remain in its normal config home.
Crash recovery uses the same native launcher and resume identity, without
requiring a Meta API key in Overdeck settings. Recovery and restart wait for
the interactive prompt before reporting success.

The shared parser in `src/lib/cost-parsers/muse-parser.ts` reads the verified
1.0.2 envelope format. Run-start and committed assistant events feed the chat
adapter; terminal events finish a turn. Private reasoning, duplicated user
intents, and internal model configuration do not become chat messages.
Tool activity and approval prompts are currently available through the terminal.

`model_completed.usage.input_tokens` includes cached input, so the parser
subtracts `cached_tokens` before applying uncached input rates. Duplicate
record IDs and incomplete trailing JSON lines do not double-count costs.
Prices are stored in `src/lib/cost.ts`; the two tier identities are preserved.

## Verification

`src/lib/__tests__/muse-support.test.ts` covers model identity, provider
configuration, policy, persistent launch and native resume, context markers,
root-session isolation, cached-token pricing, and the sanitized native echo
fixture in `tests/fixtures/muse/echo-session.jsonl`.
