# Test-requirement gate corpus

Static fixtures for PAN-1501 regression tests. Each fixture contains an issue
body and a `git diff --numstat` snapshot. The gate is expected to fire for
every fixture: the body contains test-shaped keywords and the diff adds zero
new lines under `*.test.ts`, `*.spec.ts`, `*.test.tsx`, or `*.spec.tsx`.

## Issues

- PAN-1326
- PAN-1256
- PAN-1257
- PAN-1175
- PAN-1173
- PAN-1168
- PAN-1111

## Capture commands

Issue text (body + comments) was captured with:

```bash
gh issue view <number> --repo eltmon/overdeck --json body,comments
```

Comments are included because test plans and verification notes are often
recorded in follow-up comments rather than the original issue body.

Diff snapshots were produced with:

```bash
git diff --numstat <merge-base>..<merged-sha>
```

Where `<merge-base>` is `git merge-base origin/main HEAD` for the merged
feature branch and `<merged-sha>` is the merge commit or final commit of the
feature branch.

## Snapshot date

2026-06-12
