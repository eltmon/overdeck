# PAN-4774 — fake-CLI two-machine smoke on integrated main

- **Commit tested:** `b647cea46d2` (`feature/pan-4774`: `origin/main` at planning plus this issue's commits; `npm run build` of this tree).
- **Date:** 2026-11-02, host `eltmon-z790` (Linux, Docker present).
- **Full output:** [local-smoke.log](local-smoke.log). No tokens are printed by the smoke; the pairing link URL is never logged.

## Runs

| Command | Exit | Result |
| --- | --- | --- |
| `node scripts/anywhere/two-machine-smoke.mjs` | 0 | every step passed; `OK: two dashboards linked, updated both machines' CLIs with Update all, survived a restart, and spoke only the secure channel on the pairing route` |
| `node scripts/anywhere/two-machine-smoke.mjs --inject-plain-http` | 1 | `FAILED at step no-http: plain HTTP crossed the pairing route at byte 669472: "…GET /api/environment HTTP/1.1…"` — the detector catches the injected request |

## Step to acceptance-criterion map

| AC / deliverable | Smoke step(s) | Result | Evidence line |
| --- | --- | --- | --- |
| AC-2 (local half) | `no-http` | passed | `proxy carried 667139 bytes across the pairing route`; first byte `0x00`, no `HTTP/1.1` (the `--inject-plain-http` run shows the check fails when plain HTTP crosses) |
| AC-4 (local half) | `remote-worker`, `worker-offline`, `lane-remote`, `lane-report`, `lane-nest`, `lane-reap` | passed | `A printed B's report: smoke report one`; `the wait survived B's pause and printed report two`; `A printed B's lane report; pan lane list shows 20261102-3396 on eltmon-z790 (idle)`; `root 4, linked parent 4, run smoke`; `Reaped lane smoke/smoke … B archived the row, A archived the stand-in` |
| AC-9 | `auto`, `needs-docker` (also `needs`) | passed | `Auto → eltmon-z790 (…); rejected eltmon-z790: CPU saturated` (A chosen over saturated B); `needs docker -> eltmon-z790` (A's environment id asserted) and `lane 20261102-7171 on A (machine auto, needs docker)`; `needs smoke-tag -> eltmon-z790` (B) |
| AC-12 | `mcp` | passed | `mcp: B listed, @bcd7e47e-…/smoke-desk reached (owner answered an error: HTTP 500: Delivery could not be confirmed), settings 403` |
| AC-13 (CLI half) | `forward` | passed | `forward b:37467 -> http://127.0.0.1:42935 relayed the page`; `a forward to B's dashboard port :3042 was refused` |
| AC-14 | `open-budget` | passed | `open moved 618957 bytes B->A (budget 1114112; transcript 5053880)` — 618,957 bytes measured at the proxy against the 1,114,112-byte budget for a 5,053,880-byte transcript |
| AC-15: W-CONV7 | `tell-once` | passed | `repeat replayed the first answer (exit 1: … Delivery could not be confirmed); other text refused by the receipt` |
| AC-15: W-WORK7 | `usage` | passed | `usage rows: eltmon-z790 $0, eltmon-z790 $0` (All machines equals the row sum) |
| AC-15: W-WORK8 | `compare` | passed | `compare: 3 difference(s); pan admin config set resources.quality_gate_slots 2` (B's secret shown only as set) |
| AC-15: W-LINK7 (harness half) | `versions`, `update-all` | passed | `claude 2.1.0 → 2.1.5 (updated), codex 0.150.0 → 0.159.0 (updated), overdeck skipped` on both machines |

## Notes

- **AC-12 token minting.** **Copy MCP URL** (`src/dashboard/frontend/src/components/Settings/anywhere/McpUrlDialog.tsx`) calls `POST /api/access-tokens` (`anywhereApi.ts` `createAccessToken`), whose handler (`src/dashboard/server/routes/access-tokens.ts`) calls `createAccessToken({ name, scopes, kind: 'token' })` in `src/lib/access-tokens.ts`. The smoke mints with `pan token create smoke-mcp --scopes read:state,read:conversations,tell --json` (`src/cli/commands/token.ts`), which calls that same library function with `kind: 'token'`. So the token comes from the same minting function and token registry, but not through the HTTP route; the HTTP route's own browser-only guard is not exercised here.
- **Delivery errors in `tell-once` and `mcp` are expected.** The seeded `smoke-desk` conversation has no live pane, so B answers "Delivery could not be confirmed". Those steps check the replay receipt and that the call reached B; live delivery is proven by the AC-1 CI test (`tests/integration/anywhere/two-machine-ac1.slow.test.ts`, `remote-controls a live conversation`, 7/7 passed on this tree) and by the `--live-claude` run.
- Both dashboards run on one host, so both machines carry the label `eltmon-z790`; the smoke asserts environment ids, not labels.

Status: passed
