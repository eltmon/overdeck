# Composer slash-command autocomplete

The dashboard composer derives its `pan` command suggestions from the same Commander registry as the CLI. Do not add a second hand-maintained command list to the frontend.

## Generation pipeline

```text
Commander registrations in src/cli/index.ts and src/cli/commands/**
  → pan admin commands --json
  → scripts/generate-slash-commands.mjs
       + scripts/slash-commands-curation.json
  → packages/contracts/src/composer-commands.generated.ts
  ├─→ server: policy overlay, parser/router, and GET /api/commands
  └─→ frontend: slashCommands.ts autocomplete adapter
  → scripts/lint-slash-commands.sh (drift-gates the contracts manifest; run by npm run lint)
```

`pan admin commands --json` recursively reports visible command paths, aliases, descriptions, positional arguments, options, and whether each command has visible children. Hidden commands, hidden options, and Commander's implicit `help` entries are excluded by `src/cli/command-introspection.ts`.

The generator writes one deterministic committed contracts module containing every visible command, its complete syntax metadata, category, and curated autocomplete variants. That one generated output feeds two consumers: the server combines it with the explicit policy overlay for parsing, execution, and `GET /api/commands`; the frontend adapter derives the **Overdeck** autocomplete group from the same data without maintaining another command list or importing the CLI entrypoint. The generated file has no timestamp, so two runs against the same CLI registry produce identical bytes.

Regenerate after changing CLI commands or the overlay:

```bash
npm run build:cli
npm run generate:slash-commands
```

Never edit `composer-commands.generated.ts` by hand. `scripts/lint-slash-commands.sh` regenerates it to a temporary file and fails when the committed module differs, with the command needed to repair the drift. This follows the sibling CLI drift-gate pattern in `scripts/lint-skills.sh`.

## Choosing the right curation mechanism

Use the narrowest source that owns the behavior:

- Add a **static entry** in `src/dashboard/frontend/src/components/chat/slashCommands.ts` only when it is not a `pan` CLI command. The AI CLI entries such as `/model` and the dashboard-intercepted `/handoff` live there.
- Add an **extra** to `scripts/slash-commands-curation.json` for a useful flag variant that cannot be inferred from positional command metadata, such as `pan show --cv`.
- Add a **deny prefix** to the same overlay only when a visible CLI command must deliberately stay out of the composer. The deny list ships empty; exclusions must be explicit and reviewable.
- Add an **insert override** only when preserving an established insertion affordance requires whitespace different from the argument-derived default. Keep the command path as the key so the generated entry remains unique.

Manifest categories are assigned in `scripts/slash-commands-curation.json`, with unmapped top-level verbs falling back to `CLI`. The API retains that domain metadata; the composer menu presents every generated entry under the single **Overdeck** group so it stays visually separate from active-harness-native commands.

## Routing order

Conversation and agent message endpoints validate the target and message first, then offer the exact text to the `/pan` router. A recognized portable command returns before native compaction, attachment rewriting, prompt-memory injection, FIFO/control-channel delivery, or tmux/PTY delivery can run. When the composer has pending uploads, it submits only the typed `/pan` command and leaves those attachments pending for a later prompt. Ordinary text and unprefixed `pan ...` continue through the existing harness-specific stages unchanged.

The parser rejects shell control syntax and returns typed errors for unknown commands, missing arguments, and unknown flags. The policy overlay then selects captured, detached, UI, or terminal-only execution and applies single-use confirmation requirements before any executor starts.

## No-loss rule

`src/dashboard/frontend/src/components/chat/__tests__/fixtures/slash-commands.pre-adapter.json` freezes the complete pre-adapter autocomplete surface. The no-loss audits map every unprefixed `pan` entry to its `/pan` equivalent, account for harness-native commands and all three handoff aliases, and require an explicit reason for any exclusion. The four-harness matrix separately proves that portable commands never call a delivery primitive while ordinary text still does. Update these audits only for an intentional, documented surface change; do not weaken them to make a refactor pass.
