# Handoff brief — implement PAN-2564 (Dolt-native cross-machine beads authority)

You are a **`gpt-5.6-sol`** implementation agent. Implement **PAN-2564** in full,
on the branch `bypass/pan-2564` in THIS worktree. This is an operator-authorized
pipeline-bypass: you implement, the orchestrating conversation reviews and merges
to `main`. **Do NOT run `pan done`.** Commit per work item; push to
`origin bypass/pan-2564` as you go.

## Read first (in this order)
1. **The PRD (authoritative):** `/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2564.md`
   — full spec: glossary, decisions D1–D8/D-HOME/D-MARKER, FR-1..10 + NFR-1..4,
   verified reference map §5, **work items WI-1..WI-16**, restated repo rules §7,
   checkpoints C1–C3, acceptance criteria §9.
2. **The vBRIEF spec (authoritative machine-readable plan, 18 items):**
   `/home/eltmon/.overdeck/state/panopticon-cli/specs/2026-07-12-PAN-2564-feat-beads-dolt-native-cross-machine-authority-synchronization-and-dashboard-freshness.vbrief.json`.
   Implement item-by-item; the item titles map 1:1 to the PRD's WI-1..WI-16. (The same
   18 items are also mirrored as beads under label `pan-2564` in the MAIN checkout DB —
   `cd /home/eltmon/Projects/overdeck && bd list -l pan-2564 --limit 0` — read-only
   reference; do not mutate them from your worktree.)
3. The review that shaped the PRD:
   `/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2564-FEEDBACK-gpt-5.md`.

## Scope — implement ALL of it (operator: "nothing carved out")
All 16 work items WI-1..WI-16 and every FR/NFR. Deliver the complete machinery:
migration cutover-marker gate, canonical read door (resolver), canonical write door
with `runMutationBatch`, the **agent-facing `pan beads` mutation door + bd PATH shim**,
the **one canonical local Dolt home + redirect map**, cross-machine bootstrap, dashboard
freshness (single-owner sync + WebSocket invalidation), validated JSONL export,
isolated full-fidelity reconciliation tooling, config standardization, concurrency
serialization, observability, docs, the exhaustive no-loss audit + CI guard, and the
bd version policy resolver.

## CRITICAL constraints (from the PRD §7 + repo rules — honor exactly)
- **Do NOT run the live bd upgrade/migration on the real databases.** bd is pinned at
  1.0.4/v32 right now on purpose (a 1.1.0 trial was rolled back — it broke writes on the
  split-brained remote-backed v32 DB; see PRD §2). Your job is to write the CODE and
  TOOLING: the version-policy resolver (WI-16, `bd >= 1.1.0`), the doctor checks, the
  designated-migrator/bootstrap tooling, the canonical-home unifier + redirect. The
  ACTUAL per-project cutover (running `bd migrate`/`bd dolt push` on live data) is the
  operator rollout (D8) — do NOT execute it against the real `~/.overdeck/state/...` or
  `/home/eltmon/Projects/overdeck/.beads` DBs. Use scratch/temp DBs for any live test.
- **Single read door / single write door** — extend the resolver/writer/`pan beads`
  surface; never add a parallel beads access path.
- **No `execSync`** in dashboard/server-reachable code — use `execAsync`/`spawn`;
  delays via `await new Promise(r=>setTimeout(r,ms))`.
- **Fake timers** for every delay/retry/interval test (`vi.useFakeTimers()` +
  `advanceTimersByTimeAsync`); never real `setTimeout`; never drop `maxForks` to 1.
- **Never commit Dolt DB/runtime** (`dolt/`, `embeddeddolt/`, `dolt-server.*`, `*.dolt`,
  `.beads/backup/`) to any code branch or overdeck-state.
- **Worktree discipline** — you are on `bypass/pan-2564` in an isolated worktree. Verify
  with `git branch --show-current` before your first edit. Never `git checkout` another
  branch here. Never `git stash`. Commit early and often.
- **Async tmux only** (`sendKeysAsync`) if any tmux touch is needed.
- **Effort defaults to high.**
- **Documentation is a required work item (WI-11)** — ship it, do not defer.

## Verify (quality gates, must pass before you report a chunk ready for merge)
- `npm run typecheck`  ·  `npm run lint`  ·  `npm test` (root + `src/dashboard/frontend`)
- Run `bun install` from the worktree root first (workspace-aware node_modules; never
  symlink node_modules). Rebuild `packages/contracts` if you touch it.

## How to work
- Implement each work item as its own commit (message references the WI + FR).
- After each coherent chunk builds + tests green, push to `origin bypass/pan-2564` and
  post a short status in this conversation so the orchestrator can review + merge.
- If you hit a genuine blocker or an ambiguity the PRD does not resolve, STOP and report
  it here — do not guess or invent scope.
- Do NOT run `pan done`, `pan start`, or spawn pipeline agents. You are a supervised
  implementation conversation.
