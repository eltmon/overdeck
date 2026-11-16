---
name: pan-semgrep
description: "pan semgrep ci-setup <project> — open a PR adding a Semgrep GitHub Actions workflow"
triggers:
  - pan semgrep
  - semgrep ci
  - semgrep github actions
  - semgrep workflow
allowed-tools:
  - Bash
  - Read
---

# Semgrep CI Workflow

## Overview

`pan semgrep ci-setup <project>` opens a pull request that adds `.github/workflows/semgrep.yml`
to the project's GitHub repository. It never pushes to the base branch and never touches the
project's checkout: it commits in a throwaway worktree and pushes the branch
`overdeck/semgrep-ci`.

It needs three things, and refuses with a one-line reason otherwise:

- `security.semgrep.enabled: true` in `~/.overdeck/config.yaml`. Only the operator turns it on.
- A single-repo project with `github_repo` set. Polyrepo and GitLab projects are not supported.
- An `origin` remote that is the project's `github_repo`, not a fork.

## Quick Command

```bash
# See the target repository, base branch, gate and the full workflow; changes nothing
pan semgrep ci-setup <project> --dry-run

# Open the pull request
pan semgrep ci-setup <project>

# Also scan base-branch pushes and upload results to GitHub code scanning
pan semgrep ci-setup <project> --sarif-upload
```

The command prints the pull request URL. If a pull request from `overdeck/semgrep-ci` is already
open, it prints that URL and changes nothing.

## What the workflow does

- Runs `semgrep scan` in the pinned `semgrep/semgrep` image, with one `--config` per
  `security.semgrep.configs` entry and the `security.semgrep.severity` threshold.
- Scans pull requests diff-aware (`--baseline-commit` at the merge base): only findings on code
  the pull request adds are reported.
- Sends no metrics and needs no Semgrep account or token.
- Carries the gate mode in the job's `OVERDECK_SEMGREP_GATE` line, read once from
  `verification.sast` or `security.semgrep.gate`:
  - `blocking`: a pull request that adds a finding fails the `semgrep` check, and the work agent
    gets the findings with fix and suppression instructions.
  - `advisory` (also written for `off`): the check never fails; findings show as warnings in the
    job log.

## Changing the gate later

The workflow does not follow later config changes. Edit the `OVERDECK_SEMGREP_GATE:` line in
`.github/workflows/semgrep.yml` to `blocking` or `advisory`. Overdeck never rewrites the file;
delete it to stop CI scans, or delete it and run `ci-setup` again.

## Troubleshooting

**`GitHub refused the push: the credential for origin lacks the "workflow" scope`:** pushing
files under `.github/workflows/` needs that scope. Run `gh auth refresh -s workflow` (HTTPS
remotes) or push over SSH, then run the command again.

**`already has .github/workflows/semgrep.yml`:** the base branch has the workflow. `ci-setup`
never overwrites it; edit the file by hand.

**`Branch overdeck/semgrep-ci already exists on origin with no open pull request`:** a leftover
branch from an earlier run. Delete it on GitHub, or open a pull request from it.

**Repository hooks did not run:** expected. The generated commit and push use `--no-verify`
because the throwaway worktree has no installed dependencies. The pull request's CI and review
gate the one generated file.

## Related Skills

- `semgrep` — triage findings and suppress false positives with a justified `nosemgrep`
