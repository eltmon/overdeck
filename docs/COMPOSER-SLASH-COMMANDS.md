# Composer slash-command autocomplete

The dashboard composer derives its `pan` command suggestions from the same Commander registry as the CLI. Do not add a second hand-maintained command list to the frontend.

## Generation pipeline

```text
Commander registrations in src/cli/index.ts and src/cli/commands/**
  → pan admin commands --json
  → scripts/generate-slash-commands.mjs
       + scripts/slash-commands-curation.json
  ├─→ src/dashboard/frontend/src/components/chat/slashCommands.generated.ts
  └─→ packages/contracts/src/composer-commands.generated.ts
  → scripts/lint-slash-commands.sh (drift-gates both outputs; run by npm run lint)
```

`pan admin commands --json` recursively reports visible command paths, aliases, descriptions, positional arguments, options, and whether each command has visible children. Hidden commands, hidden options, and Commander's implicit `help` entries are excluded by `src/cli/command-introspection.ts`.

The generator writes two deterministic committed modules. The frontend autocomplete output keeps runnable leaves and command nodes that accept positional arguments, then applies the curation overlay. The contracts manifest contains every visible command with its complete syntax metadata and category so the dashboard server and frontend can share one command description without importing the CLI entrypoint. Neither generated file has a timestamp, so two runs against the same CLI registry produce identical bytes.

Regenerate after changing CLI commands or the overlay:

```bash
npm run build:cli
npm run generate:slash-commands
```

Never edit `slashCommands.generated.ts` or `composer-commands.generated.ts` by hand. `scripts/lint-slash-commands.sh` regenerates both to temporary files and fails when either committed module differs, with the command needed to repair the drift. This follows the sibling CLI drift-gate pattern in `scripts/lint-skills.sh`.

## Choosing the right curation mechanism

Use the narrowest source that owns the behavior:

- Add a **static entry** in `src/dashboard/frontend/src/components/chat/slashCommands.ts` only when it is not a `pan` CLI command. The AI CLI entries such as `/model` and the dashboard-intercepted `/handoff` live there.
- Add an **extra** to `scripts/slash-commands-curation.json` for a useful flag variant that cannot be inferred from positional command metadata, such as `pan show --cv`.
- Add a **deny prefix** to the same overlay only when a visible CLI command must deliberately stay out of the composer. The deny list ships empty; exclusions must be explicit and reviewable.
- Add an **insert override** only when preserving an established insertion affordance requires whitespace different from the argument-derived default. Keep the command path as the key so the generated entry remains unique.

Categories are also assigned in `scripts/slash-commands-curation.json`. Unmapped top-level verbs fall back to the `CLI` category, so a newly registered command still appears even before someone chooses a more specific section.

## No-loss rule

`src/dashboard/frontend/src/components/chat/__tests__/slashCommands.no-loss.test.ts` pins the complete pre-generation autocomplete surface. Every old entry must either retain its exact insertion text or appear in the deliberate-removals table with evidence that its CLI path no longer exists. Update that audit when intentionally removing an affordance; do not weaken it to make a refactor pass.
