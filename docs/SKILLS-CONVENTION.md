# Panopticon Skills ↔ CLI Convention

How Panopticon's Claude Code skills relate to the `pan` CLI binary, and the rules
for keeping the two in sync.

## TL;DR

- **`pan <verb>`** = a subcommand of the `pan` binary. Discoverable via `pan --help`.
- **`/pan-<verb>`** = a Claude Code skill at `skills/pan-<verb>/SKILL.md` that *wraps* `pan <verb>`. Discoverable when an agent types `/pan-<verb>` or when a skill's triggers match user intent.
- The `pan-` prefix is also a **namespace** — workflow, reference, and topical skills use the same prefix without being a 1:1 wrapper of a CLI verb.
- Not every CLI verb gets a skill. Trivial verbs whose `--help` is enough are deliberately excluded.

## The four shapes a `pan-*` skill takes

| Shape | What it is | Example |
|---|---|---|
| **CLI-wrapper** | Wraps a single `pan <verb>` command. Body explains when to invoke it and how to interpret common outputs. | `/pan-start` → `pan start <id>` |
| **CLI-sub-wrapper** | Wraps a sub-namespaced command. | `/pan-admin-hooks` → `pan admin hooks` |
| **Workflow** | Orchestrates multiple CLI verbs in a specific order to accomplish a higher-level goal. | `/pan-code-review`, `/pan-oversee` |
| **Reference** | Documentation-only. Does not directly invoke commands; tells the agent how to think about a concept or where to look. | `/pan-workflow`, `/pan-quickstart`, `/pan-help` |
| **Topical** | Covers a topic that doesn't map to a single CLI verb but lives in Panopticon's namespace. | `/pan-network`, `/pan-docker`, `/pan-tts` |

## Rules

### For CLI-wrapper skills

1. **Directory name matches the verb.** `pan-<verb>/` ↔ `pan <verb>`. No abbreviation, no synonym. If the CLI command is `pan doctor`, the skill is `pan-doctor`, not `pan-health`.
2. **Frontmatter description starts with the wrapped command.** Format: `"pan <verb> [args] — one-line purpose"`.
3. **Every flag, subcommand, and argument the SKILL.md mentions must exist on the current CLI.** The skills linter (`scripts/lint-skills.sh`) enforces this — see "Linting" below.
4. **When the CLI changes, the skill changes in the same commit.** A CLI change that breaks a wrapper skill is incomplete.

### For workflow / reference / topical skills

1. Still use the `pan-` prefix — the prefix is what tells discovery tooling and agents the skill belongs to Panopticon's namespace.
2. Frontmatter description should make the shape obvious: `"Workflow:"`, `"Reference:"`, `"Topical:"` is allowed as a lead-in but not required.
3. These skills are exempt from the strict CLI-flag matching the wrappers are subject to — they're allowed to discuss CLI verbs descriptively without being required to enumerate every flag.

## What does NOT get a wrapper skill

Wrapping every CLI verb in a skill is a tax, not a feature. A skill exists to add **non-trivial guidance** beyond what `--help` already prints. Verbs that get wrapped:

- Have a non-obvious workflow (when to use, what to read first, how to interpret output).
- Compose with other commands the agent should know about.
- Have failure modes that need specific recovery advice.

`pan pause`, `pan unpause`, and `pan untroubled` are intentionally wrapped because their persistent gate semantics and interaction with `pan start` / `pan kill` need more guidance than `--help` can provide.

Verbs that **don't** get wrapped (current exclusion list, with rationale):

| Verb | Why no skill |
|---|---|
| `pan backup`, `pan restore` | `--help` is sufficient; no judgment calls. |
| `pan caveman-compress` | Internal-only utility. |
| `pan fork`, `pan unarchive-conversation`, `pan resume` | Single-purpose, output is self-explanatory. |
| `pan inspect` | Diagnostic output is intended for humans to read directly. |
| `pan open` | Trivial — opens an editor. |
| `pan recover`, `pan restore` | Recovery flows are documented in workflow skills (`pan-diagnose`, `pan-workflow`). |
| `pan scope`, `pan swarm`, `pan workspace`, `pan test` | Power-user commands documented in topical/workflow skills as needed. |
| `pan cost`, `pan update`, `pan serve` | Operations whose `--help` is self-contained. |
| `pan health` | Distinct from `pan doctor`; runtime-health output is meant to be read directly. |

This list is **deliberate, not aspirational.** Adding a wrapper for any of these should be justified case-by-case.

## Linting

`scripts/lint-skills.sh` runs as part of `npm run lint`. For every CLI-wrapper skill, it:

1. Extracts every `pan <verb> ...` invocation from the SKILL.md.
2. Cross-checks each flag, subcommand, and positional argument against `pan <verb> --help`.
3. Fails CI if any reference doesn't exist on the current CLI.

Workflow / reference / topical skills are not subject to the strict invocation-parse check, but the linter still flags obviously stale references (e.g., a command that no longer exists at all).

### When the linter trips you up

- If you're **adding a CLI flag**, update the wrapper skill in the same commit.
- If you're **removing a CLI flag**, search the `skills/` tree for references and clean them up in the same commit.
- If you're **renaming a verb**, rename the wrapper directory in the same commit.
- If you're keeping a one-release compatibility redirect for a renamed skill, add it to the linter's legacy redirect table. The old skill must be a minimal redirect stub, not a copy of the old workflow.

## How skills are distributed

Source of truth lives in `skills/` in the panopticon-cli repo. The flow:

```
skills/pan-<verb>/SKILL.md            (canonical, committed)
        │
        │ pan sync
        ▼
~/.panopticon/skills/pan-<verb>/      (installed copy)
        │
        │ pan sync (devroot symlink)
        ▼
~/.claude/skills/pan-<verb>/          (Claude Code discovers from here)
```

Run `pan sync` after editing any skill source to push it through to your active Claude sessions.

## Creating a new wrapper skill

1. Confirm the verb meets the "non-trivial guidance" bar above.
2. Add a CLI verb if one doesn't exist yet (or document why the skill wraps an existing command differently).
3. Create `skills/pan-<verb>/SKILL.md` with frontmatter that starts with `"pan <verb> [args] — purpose"`.
4. Write the body. Keep it tight — only add what isn't already obvious from `--help`.
5. Run `npm run lint` to confirm the linter accepts the new skill.
6. Run `pan sync` to install it locally.

For the full skill-authoring guide (frontmatter shape, trigger phrasing, progressive disclosure), see `/pan-skill-creator`.

## Related

- `/pan-skill-creator` — skill authoring guide
- `scripts/lint-skills.sh` — the consistency linter
- `scripts/lint-permissions.sh` — a sibling linter for permission-flag emission (different concern, same shape)
