---
name: pan-knowledge
description: "pan knowledge <id> — spawn a knowledge agent to maintain the project's Open Knowledge Format (OKF) bundle"
triggers:
  - pan knowledge
  - knowledge agent
  - okf agent
  - run okf
  - knowledge sync
  - knowledge study
  - knowledge retro
allowed-tools:
  - Bash
  - Read
---

# pan knowledge

Run the command now:

```bash
pan knowledge <issue-id>
```

## Usage

```
pan knowledge PAN-123                        # Sync project knowledge
pan knowledge PAN-123 --focus "auth flow"    # Study a topic, then sync
pan knowledge PAN-123 --retro                # Capture retro knowledge, then sync
pan knowledge PAN-123 --model claude-sonnet-5  # Override the knowledge role model
pan knowledge PAN-123 --effort high          # Raise reasoning effort for the agent
```

## What It Does

`pan knowledge <id>` spawns a dedicated knowledge agent that maintains the
project's OKF bundle (`<project>-knowledge` by default). The agent reads
`roles/knowledge.md` for its contract and is allowed only to open PRs against
the knowledge repository — it never merges code, transitions the implementation
issue, or runs `pan done`.

The agent runs a sequence of `/okf` commands depending on the flags you pass:

- No flags: run `/okf sync`.
- `--focus "<topic>"`: run `/okf study "<topic>"`, then `/okf sync --topic "<topic>"`.
- `--retro`: run `/okf retro`, then `/okf sync`.
- Both flags: study, retro, then sync scoped to the topic.

The command first tries to ensure `mnemos` is available on `PATH` (installing it
on demand if necessary) and ingest the resolved bundle. If mnemos is unavailable,
it falls back to the built-in OKF search scripts under `skills/okf/scripts/`.

## When to Use

- After merging a feature to capture knowledge that would have helped the work
  (`pan knowledge <id> --retro`).
- Before starting a focused feature to document current behavior
  (`pan knowledge <id> --focus "<topic>"`).
- When code or docs change and the knowledge bundle needs a routine update
  (`pan knowledge <id>`).

## Configuration

The knowledge agent resolves the OKF bundle in this order:

1. `projects.yaml` `knowledge_repo:` for the project.
2. `.okf.yml` `bundle:` in the code repository root.

If neither is configured, the command errors with instructions to run
`/okf init` first.

## See Also

- `/okf` skill — the standalone OKF command reference
- `roles/knowledge.md` — the knowledge agent's role contract
- `pan start <id>` — spawn an implementation agent for the same issue
