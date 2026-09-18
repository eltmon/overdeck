# Investigation: run Lexerra gauntlet workloads on remote Fly.io machines

## Why
The local machine (single box) runs the whole RUN CHARLIE gauntlet: 5+ Vite servers,
headed-Chromium film rigs, Playwright e2e, vitest suites, Postgres+Redis, several worktree
builds, plus Overdeck itself. It hard-crashed today (2026-08-23 ~04:10, likely resource
exhaustion) and is the bottleneck for scaling to 9+ concurrent lanes. Overdeck has *sort of*
limited Fly.io support already; the operator wants to know how to offload Lexerra work to
remote Fly machines.

## Your deliverable
A written report: ~/Projects/hoff-fly-lexerra/FLY-LEXERRA.md — concrete, executable options
ranked by effort-to-value, each with exact commands/configs. INVESTIGATION ONLY: do not
deploy anything, do not modify Overdeck or Lexerra code, do not spend money without listing
the cost first.

## What to investigate
1. Existing Overdeck Fly support: the `pan-fly` skill (`pan fly --help`), Overdeck source
   ~/Projects/overdeck (search fly.io / remote workspace machinery), ~/.overdeck/config.yaml
   for Fly config/tokens. What works TODAY (remote workspaces? machine exec? tunneling?) and
   what is stubbed?
2. Lexerra's needs per workload class, and which offload cleanly:
   a. Headless CI-style: builds, vitest unit suites, Playwright e2e (needs own Postgres/Redis
      + built server — see /home/eltmon/Projects/lexerra/CLAUDE.md, docker-compose.dev.yml,
      playwright config).
   b. Film rigs: headed Chromium with GL (--use-gl=angle etc.) — does software GL
      (swiftshader/llvmpipe) on a Fly machine produce pixel-faithful captures? Constraints?
   c. Full agent worktrees: could a whole builder agent (Claude Code CLI) run on a Fly
      machine against a repo checkout + its own stack? What does Overdeck's remote-workspace
      flow already give here?
3. Practicalities: machine sizes/cost per hour per class, image/volume strategy (repo ~6GB
   with assets; node_modules; browser installs), how results come back (git push of
   shots/notes is the native gauntlet pattern), secrets (fresh throwaway DB creds only),
   teardown discipline.
4. Recommend: ONE fastest-to-value offload first (guess: e2e + unit suites as a Fly job),
   the medium-term one, and what NOT to offload (likely film rigs if GL fidelity fails —
   check, don't assume).

## Constraints
- fly CLI may be unauthed — check `fly auth whoami`; if unauthed, note as operator action.
- Read-only toward the lexerra and overdeck repos. Your only writes: this dir.
- Every recommendation carries $/hr and est. monthly at expected duty cycle.
