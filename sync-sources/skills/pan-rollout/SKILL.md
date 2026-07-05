---
name: pan-rollout
description: "pan rollout — inspect and retry coordinated post-merge releases"
triggers:
  - pan rollout
  - rollout status
  - retry release
allowed-tools:
  - Bash
  - Read
---

# pan rollout

Use this skill when checking or retrying the coordinated release for an issue after merge.

## Commands

```bash
pan rollout status <id>
pan rollout retry <id>
```

## Status

```bash
pan rollout status PAN-399
```

Prints the issue releaseStatus and each release component's order, key, and status from the persisted release set.

## Retry

```bash
pan rollout retry PAN-399
```

Re-runs the release for the issue and prints the resulting releaseStatus and ordered component states. The command uses the existing release set project path when present, otherwise it falls back to the issue merge set.

## Guardrails

- Use `pan rollout status <id>` before retrying so the current component state is visible.
- Use `pan rollout retry <id>` only after the underlying release config or external deployment condition has changed.
- Do not use `pan release` for coordinated rollouts; `pan release` is the package publish flow.
