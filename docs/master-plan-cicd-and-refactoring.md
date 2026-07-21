# Master Plan — CI/CD Reliability × Refactor Campaign (2026-07-04)

**Audience:** the orchestrating session that drips these items into the pipeline.
**Feeds from:** `docs/ci-cd/CICD-QUEUE.md` (epic [PAN-2376](https://github.com/eltmon/overdeck/issues/2376)) and
`docs/codebase-health/REFACTOR-QUEUE.md` (Phase 3 remainder). Those two docs stay the
per-campaign source of truth for item detail and status; **this file owns only the
cross-campaign ordering and parallelism rules.** Update status in the queue docs, not here.

## The one idea

The two campaigns collide in exactly one neighborhood — **the cloister core**
(`deacon.ts`, `deacon-merge.ts`, `cloister/service.ts`, `specialists.ts`,
`merge-agent.ts`, swarm modules). Everything else is disjoint. So: run two lanes.

- **Lane A (parallel-safe):** small, peripheral items. Multiple may be in the pipeline
  at once, and Lane A runs concurrently with Lane B at all times.
- **Lane B (strictly serial):** cloister-adjacent work. Exactly ONE Lane B item in
  flight at any moment, ordered small-fixes-first, decompositions-second. TENET-10
  applies: a red main here stalls the pipeline that ships the fix — full suite before
  merge, verify against origin/main HEAD.

Why small-fixes-first in Lane B: rebasing a decomposition over eight landed surgical
fixes costs one PRD re-verification; landing a decomposition first rewrites every grep
anchor in eight CI/CD PRDs at once. Also the CI/CD fixes stop weekly stranding
incidents (live bleeding); the refactors don't bleed.

## Lane A — dispatch in this order, overlap freely

| Order | Issue | Note |
|---|---|---|
| A1 | [PAN-2373](https://github.com/eltmon/overdeck/issues/2373) | Flake policy. **Dispatch first — it de-risks every later verification run**, including Lane B's. |
| A2 | [PAN-2371](https://github.com/eltmon/overdeck/issues/2371) | UAT flake fix. Stands alone; its quarantine-removal step depends on A1 having landed. |
| A3 | [PAN-2336](https://github.com/eltmon/overdeck/issues/2336) | create-beads mock-bypass fix. Independent. |
| A4 | [PAN-2095](https://github.com/eltmon/overdeck/issues/2095) | pan reload builds origin/main. Independent. |
| A5 | [PAN-2375](https://github.com/eltmon/overdeck/issues/2375) | Auto-commit debounce + push. Independent. |
| A6 | [PAN-2374](https://github.com/eltmon/overdeck/issues/2374) | CodeRabbit. Independent. |
| A7 | [PAN-2230](https://github.com/eltmon/overdeck/issues/2230) | Circular-dep ratchet. Independent. |
| A8 | [PAN-2297](https://github.com/eltmon/overdeck/issues/2297) | Baseline auto-lower in post-merge-deploy.sh. Independent of Lane A, **but must LAND before Lane B reaches [PAN-2233](https://github.com/eltmon/overdeck/issues/2233)** (merge-agent decomposition shifts its PRD's call-path context). |
| A9 | [PAN-2229](https://github.com/eltmon/overdeck/issues/2229) | Prompt-regression evals. Pre-epic PRD — re-verify before dispatch. |
| A11 | [PAN-2108](https://github.com/eltmon/overdeck/issues/2108) | Dead-recipient recovery audit (operator-priority 2026-07-06): verdicts delivered to dead/paused work agents must trigger needs-you or gated auto-resume — the silent hour-eater. STRUCK for immediate landing; order-book entry is the durable follow-through. Cloister-adjacent: coordinate with B-lane if diffs collide. |
| A12 | [PAN-2436](https://github.com/eltmon/overdeck/issues/2436) | bd-lock contention successor (operator-priority): scope the global mutex, lock-free patrol reads, finalize hold-shrink. STRUCK for immediate landing. |
| A13 | [PAN-2445](https://github.com/eltmon/overdeck/issues/2445) | Autonomous-dispatch hardening (operator-added): patrol/reconciler planning spawns respect pickup posture; no silent-Fable staffing on autonomous paths. Evidence corrected (min-206 was a misrouted operator command via PAN-2449) — this is preventive policy + tests. |
| A10 | [PAN-2420](https://github.com/eltmon/overdeck/issues/2420) | GitHub App merge-door hardening (operator-added 2026-07-06): boot preflight verifying the App can merge (names missing scopes), permission-vs-transient error distinction, auto-reconcile when a PR merges out-of-band after a door failure. Permission itself already fixed; this is the durable guard. |
| — | [PAN-2265](https://github.com/eltmon/overdeck/issues/2265) | Already in-review — shepherd to close, no dispatch. |
| — | [PAN-2358](https://github.com/eltmon/overdeck/issues/2358) | Not part of either campaign; normal pipeline flow whenever convenient. |

Lane A items are pipeline-flow-safe: `pan plan <id> --auto` (PRD-first will pick up the
draft) → `pan start <id>`. They do not consume the Lane B slot.

## Lane B — strictly serial, one in flight, in this order

| Order | Issue | Campaign | Why this position |
|---|---|---|---|
| B0 | [PAN-2318](https://github.com/eltmon/overdeck/issues/2318) | Operator-priority (2026-07-05) | Dashboard event-loop starvation, remaining streams 2–4 (active-issue scoping, sync-read purge, tactical). Stream 1 (deacon extraction) landed as 5f718b963d — planning must re-verify what remains. **Runs before B1**: the watchdog "unreachable" false-positive it fixes restarts the dashboard unrequested, which endangers every later Lane B merge. Scope addition: supervisor-watchdog boot grace period (PAN-1714 recurrence, 2026-07-05 incident). PRD: `drafts/pan-2318.md` on `overdeck-state`. |
| B1 | [PAN-2207](https://github.com/eltmon/overdeck/issues/2207) | CI/CD P1 | done.ts + deacon patrol; smallest convergence fix |
| B2 | [PAN-2341](https://github.com/eltmon/overdeck/issues/2341) | CI/CD P1 | deacon boot reconcile + zombie reap |
| B3 | [PAN-2167](https://github.com/eltmon/overdeck/issues/2167) | CI/CD P1 | clean-tree gate (review-pipeline.ts) |
| B4 | [PAN-2359](https://github.com/eltmon/overdeck/issues/2359)+[PAN-2363](https://github.com/eltmon/overdeck/issues/2363) | CI/CD P2 | shared provably-merged guard (one PRD, two issues) |
| B5 | [PAN-2360](https://github.com/eltmon/overdeck/issues/2360)+[PAN-2300](https://github.com/eltmon/overdeck/issues/2300) | CI/CD P2 | strike contract + squash verification (one PRD, two issues) |
| B6 | [PAN-2270](https://github.com/eltmon/overdeck/issues/2270) | CI/CD P2 | strike PRs reviewable |
| B7 | [PAN-2372](https://github.com/eltmon/overdeck/issues/2372) | CI/CD P2 | atomic statusOverrides on slot done |
| B8 | [PAN-2364](https://github.com/eltmon/overdeck/issues/2364) | CI/CD P2 | per-slot failure isolation |
| B9 | [PAN-2149](https://github.com/eltmon/overdeck/issues/2149) | Refactor P3 | cloister/service.ts decomposition — **re-verify PRD first** (written 07-02; B1–B8 and 4+ other commits have touched its neighborhood) |
| B10 | [PAN-2232](https://github.com/eltmon/overdeck/issues/2232) | Refactor P3 | cloister/specialists.ts — re-verify PRD |
| B11 | [PAN-2233](https://github.com/eltmon/overdeck/issues/2233) | Refactor P3 | cloister/merge-agent.ts — re-verify PRD; requires A8 landed; in-flight-guard test must stay green |
| B12 | [PAN-2190](https://github.com/eltmon/overdeck/issues/2190) | Refactor P3 | routes/workspaces/merge-ops.ts — re-verify PRD |
| B13 | [PAN-2189](https://github.com/eltmon/overdeck/issues/2189) | Refactor P3 | deacon.ts — **PRD deliberately not written yet**; author it fresh only after B1–B12 land (its seams shift with each) |

## Lane M — Mind Your Now (parallel project lane, operator-added 2026-07-06)

Different project ⇒ fully parallel with Lanes A/B; shares only the global agent-load
governor. Source: operator conversation 501 (MIN backlog audit) + conv 485 (voice).
**Operator holds UAT on this lane where flagged: work everything, assemble merge
trains, but flagged items wait for operator review before merge.**

| Order | Issue | Note |
|---|---|---|
| M0 | MIN-857 | Gemini voice UX overhaul — already in pipeline (gpt-5.5). **UAT-hold: operator reviews before merge.** |
| M1 | MIN-860 | Push notification delivery fix (Urgent — no pushes reach iPhone/Android until landed). Dispatch first in this lane. |
| M2 | MIN-861 | Smartwatch notifications — depends on M1. |
| M3 | MIN-854 | Fizzy-style notification tray adoption (styling + primary notification system). |
| M4 | MIN-858 | System comment authorship. |
| M5 | MIN-859 | Zone entropy. |
| M6 | MIN-862 | Reminders backend enablement (mostly one-line-ish change + verification) — the epic's point made real. **Slots after M1.** |
| M7 | MIN-729 | Strikethrough animation remainder — **slots after M3** (the tray likely fixes its display half; re-verify remaining scope post-M3). |

Related, NOT in the lane: MIN-75 carries a scope note (delivery-status tracking,
per-category rate limiting) referencing the MIN-860 PRD — normal backlog flow.
PRDs for M1–M5 are in the mind-your-now-docs repo (committed by conv 501, e0862b0).

## Rules for the drip orchestrator

1. **Concurrency:** any number of Lane A items in the pipeline + at most ONE Lane B
   item. Never two Lane B items, even if the first is "just in review" — cloister
   rebases across each other are the failure mode this plan exists to prevent.
2. **Gate between Lane B items:** main green on origin (CI conclusion, not local runs)
   AND the previous Lane B item closed out before dispatching the next.
3. **Re-verify before dispatch:** every PRD carries `Verified-Against: main @ <sha>`.
   If any file the PRD touches changed since that sha, walk its
   `## Re-verify at execution` section (or re-check its grep anchors) before
   `pan plan --auto`. This is mandatory for B9–B12 and cheap for everything else.
4. **Dispatch mechanics:** `pan plan <id> --auto` (PRD-first planning lowers the draft
   at `drafts/PAN-<n>.md` on `overdeck-state`), then `pan start <id>`. Do not pass `--model` or
   `--harness` — provider defaults route correctly. If the dashboard URL errors, prefix
   `OVERDECK_DASHBOARD_URL=http://localhost:3011`.
5. **Paired items (B4, B5):** plan and start under the PRD's primary issue
   (PAN-2359, PAN-2360); close the paired issue (PAN-2363, PAN-2300) in the same
   close-out with a comment pointing at the landing PR.
6. **Update status columns** in the two queue docs as items move (commit the doc edit
   with the close-out). This master plan's tables are ordering-only — don't maintain
   status here.
7. **Releases stay operator-owned** (`pan release stable`) — report readiness, never tag.
8. **Escalate, don't improvise:** if a Lane B item reddens main, strike the minimal
   revert/fix first (strike agents are for exactly this), then resume the lane. If a
   PRD turns out to be stale beyond its re-verify section, stop and re-author rather
   than guessing — these files are the pipeline's own machinery.

## Standing context

- Refactor Phase 3 was gated `needs-handoff`; this plan plus the operator's direction
  to drip it constitutes that handoff.
- Exit criteria live in the epic ([PAN-2376](https://github.com/eltmon/overdeck/issues/2376)) and REFACTOR-QUEUE.md; when both
  queues drain, the follow-ups are refactor PAN-2189 close-out and the CI/CD epic's
  14-day convergence observation window.
