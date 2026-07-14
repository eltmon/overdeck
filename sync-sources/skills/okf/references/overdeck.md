# Overdeck Integration Contract

The OKF skill is portable. It may detect Overdeck and use it as feedstock, but the core scripts and workflow must not import Overdeck code.

## Detection

Overdeck is available only when:

1. `pan` is on `PATH`.
2. `pan` responds successfully to a lightweight command such as `pan --help` or a specific read command.

Detection is by command execution, never by Python or TypeScript imports.

## Retro Feedstock

When Overdeck is detected, `/okf retro` may mine observations for the issue:

```bash
pan memory search --issue <issue-id> "<focus or recent decisions>" --json
```

Observation records are evidence. Concepts created from them must cite the recorded decision, observation text, issue ID, or transcript reference used as source material.

When Overdeck is not detected, `/okf retro` falls back to:

- `git diff` for the implemented change.
- Current transcript or session notes available to the agent.
- Existing bundle concepts found through `/okf extract`.

The fallback path must still create validating concepts and must not require `pan`.

## PR Boundary

Retro writes to a knowledge-repo branch and opens a PR. It does not push directly to the default branch. Before opening the PR, run:

```bash
python3 <okf-skill-dir>/scripts/reindex.py --bundle <bundle> --log-entry "<entry>"
python3 <okf-skill-dir>/scripts/validate.py --bundle <bundle> --strict
```

If validation fails, fix the bundle first.
