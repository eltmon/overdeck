# Implement FLY-LEXERRA.md recommendation 1: ephemeral Fly CI jobs for Lexerra

Your own report FLY-LEXERRA.md (this dir, committed) is the spec. Implement the "do first"
item ONLY: ephemeral `flyctl machine run --rm` jobs that run Lexerra build + vitest unit
suites (server/client/shared) — and if feasible in the same pass, the Playwright e2e suite
with its own throwaway PG+Redis — on remote Fly machines, reporting results back.

Ground rules:
- fly CLI is authed (edward.becker@gmail.com). COST GUARDRAILS: smallest machine size that
  works (start shared-cpu-4x/8GB, only escalate with measurement), --rm ALWAYS (no
  persistent machines, no volumes yet), destroy anything you create, and log every run's
  $ estimate in the deliverable. Total experiment budget: a few dollars.
- Deliverable: gauntlet/fly/ in the MAIN repo (/home/eltmon/Projects/lexerra) — a
  runnable script (e.g. fly-ci.sh) + a Dockerfile/image strategy + README with measured
  timings and per-run cost. Commit path-scoped on gauntlet-charlie-ox and push. Do NOT
  touch game source.
- The repo is ~6G with assets; prefer a base image + shallow clone (or tarball upload of
  a git archive) over baking the repo into an image. Measure cold-start honestly.
- Verify end-to-end at least once: a real remote run of server+client unit suites whose
  pass/fail lands back locally (exit code + log capture).
