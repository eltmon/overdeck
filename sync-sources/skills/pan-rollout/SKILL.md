---
name: pan-rollout
description: "pan rollout <status|retry> <id> — inspect or re-run post-merge release coordination"
triggers:
  - pan rollout
  - rollout status
  - rollout retry
  - release status
  - retry release
allowed-tools:
  - Bash
---

# pan rollout

Post-merge release coordination for projects with a `release:` config section.
This is distinct from `pan release`, which publishes npm stable/canary packages.

```bash
pan rollout status <issue-id>
pan rollout retry <issue-id>
```

## What It Does

`pan rollout status` prints the issue's `releaseStatus` and each configured
component's key, release order, and current status.

`pan rollout retry` re-runs the release engine for the issue (health checks,
version checks, smoke tests, rollback if configured) and prints the resulting
status.

## When to Use

- After a merge, to see whether the coordinated release is in progress, passed,
  failed, partial, or rolled back.
- To manually retry a release after fixing a failed component or external
  deploy.

## Release Configuration

Projects opt in via `projects.yaml`:

```yaml
projects:
  - key: myn
    release:
      components:
        api:
          provider: kubernetes
          trigger: auto
          health_url: https://api.myn.example.com/health
          version_check: scripts/check-version.sh api
          smoke_test: scripts/smoke.sh api
          rollback: scripts/rollback.sh api
        frontend:
          provider: vercel
          trigger: auto
          depends_on: [api]
          health_url: https://myn.example.com/health
          smoke_test: scripts/smoke.sh frontend
        docs:
          provider: vercel
          trigger: skip
```

`trigger: auto` means Overdeck waits for the external deploy and verifies it;
it does not invoke the provider deploy itself. `trigger: manual` blocks and
requires an operator to release that component. `trigger: skip` excludes the
component from the plan.
