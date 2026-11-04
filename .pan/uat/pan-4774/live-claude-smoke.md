# PAN-4774 — two-machine smoke with real Claude Code (AC-1, real model)

- **Commit tested:** `6c5c664deca` (`feature/pan-4774`, built tree), plus this commit's one-line cleanup fix to `scripts/anywhere/two-machine-smoke.mjs` for run 2 (no `dist/` change).
- **Date:** 2026-11-02, host `eltmon-z790`, real `HOME` and `PATH` (the operator's Claude Code login).
- **Command:** `node scripts/anywhere/two-machine-smoke.mjs --live-claude`
- **Full output:** [live-claude-smoke.log](live-claude-smoke.log) (both runs; no tokens are printed).

## Results (run 2)

| Step | Result | Output |
| --- | --- | --- |
| `remote-reply` | passed | `@c9889dfb-…/20261102-5309 answered through A` — a real Claude conversation on B answered "What is 4650 doubled?" with `9300`, read through A's `/messages` |
| `pull` | passed | `pulled to A as 20261102-0b1f (cwd …/.tmp/anywhere-b/live-project); B answers 409 conversation-released` — `pan conv pull --stop-turn --json` reached `state: done`, `uncommitted.txt` is present in the row's cwd, and B refuses new turns |
| `open-budget` | passed | `open moved 618957 bytes B->A (budget 1114112; transcript 5053880)` |
| `no-http` | passed | `proxy carried 729243 bytes across the pairing route`, first byte `0x00`, no `HTTP/1.1` |
| exit | 0 | `OK: two dashboards linked, shared and pulled a live conversation, survived a restart, and spoke only the secure channel on the pairing route` |

Run 1 (same commit, before the fix) also exited 0 with the same step results.

## Findings

- **Single-host pull adopts into B's checkout.** The pulled row's cwd is `.tmp/anywhere-b/live-project`, B's own checkout, because on one host B's saved cwd exists for A too (PRD "Single-host tautology"). This run therefore proves that the transcript crosses the link, the turn stops, A adopts and B refuses; it does not prove the WIP bundle is applied in a distinct checkout. That half is proven by the CI test `tests/integration/anywhere/two-machine-ac1.slow.test.ts` (`pulls it with uncommitted changes`, adopting into A's own clone through `OVERDECK_TEST_ADOPT_SKIP_SAVED_CWD=1`) and, across two real filesystems, by AC-5 on Fly.
- **Fixed: `--live-claude` left two empty tmux servers.** After run 1, `tmux -L overdeck-<hash> … -f /tmp/pan4650-smoke-{a,b}/tmux/overdeck.tmux.conf start-server` stayed alive with no sessions, because `killSmokeTmux()` returned early in live mode (the sockets are named from `OVERDECK_HOME`, not `pan-smoke-a|b`). The fix in this commit kills them by their config path (`pkill -f '/tmp/pan4650-smoke-[ab]/tmux/overdeck.tmux.conf'`) at start and in cleanup. Verified by run 2: `pgrep -af pan4650-smoke` printed nothing afterwards. A smoke script has no unit test harness, so the D-4 "unit test that fails before the fix" is replaced by the before/after runs.

Status: passed
