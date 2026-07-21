# Fail-safe & subsystem-control architecture (proposal)

**Status:** Proposal for review · **Author:** orchestrating conversation, 2026-06-29
**Relates to:** [PAN-2075](https://github.com/eltmon/overdeck/issues/2075) (Boot Reconciliation + Operator Inbox epic), [PAN-2076](https://github.com/eltmon/overdeck/issues/2076), [PAN-2078](https://github.com/eltmon/overdeck/issues/2078), [PAN-1963](https://github.com/eltmon/overdeck/issues/1963) (no-resume default), [PAN-2160](https://github.com/eltmon/overdeck/issues/2160) (flywheel lifecycle — first slice, landed).

## Why this exists

`OVERDECK_NO_RESUME` started life as one thing — a **fail-safe against runaway agents burning tokens on error loops** — then accreted scope (deacon, flywheel, review re-dispatch, orphan recovery) and was finally made the **boot default** (PAN-1963) to stop restart death-loops. It was never architected; it now conflates several unrelated concerns into one env flag, and the control surface as a whole is scattered across env vars, SQLite, agent `state.json`, config files, and a watchdog state file with no single place to read or set it. The recurring symptom is the **death-loop class of bug**: a watchdog restart re-applies the no-resume default, the flywheel can't be nudged, it dies, and nothing brings it back (the exact thing PAN-2160 just patched for the flywheel specifically).

This proposal separates the conflated concerns into a small set of **orthogonal controls**, gives the control plane **one durable storage model and one status surface**, and replaces no-resume-by-default with a **boot-reconciliation grace window** so resume-by-default becomes safe.

## The current mechanisms (verified map)

Ten distinct controls exist today (file:line from the codebase):

| # | Control | Scope | Storage | Read/enforced |
|---|---|---|---|---|
| 1 | Agent auto-resume gate (`OVERDECK_NO_RESUME`/`OVERDECK_RESUME`) | boot + runtime | **process env** | `src/lib/boot-gates.ts:54` `resolveBootGates`; `src/lib/cloister/no-resume-mode.ts:14` |
| 2 | Deacon global pause | runtime | SQLite `app_settings: deacon.globally_paused` | `deacon.ts` patrol guard; `pan admin cloister freeze/unfreeze` |
| 3 | `OVERDECK_DISABLE_DEACON` | boot | process env | `main.ts` startup; skips Cloister + tracker polling |
| 4 | Per-issue deacon ignore | per-issue | SQLite `review_status.deacon_ignored` | `deacon-merge.ts`, `stuck-remediation.ts` (no CLI to set it) |
| 5 | Per-agent pause | per-agent | agent `state.json` `paused` | `pan pause`/`pan unpause` |
| 6 | Troubled gate | per-agent | agent `state.json` `troubled` + failure counters | `pan untroubled`; blocks resume |
| 7 | Concurrency brakes (PAN-1665) | runtime | config | `concurrency.ts`; `pan admin cloister brake` |
| 8 | Supervisor watchdog | runtime daemon | `~/.overdeck/supervisor-watchdog.json` | `src/supervisor/watchdog.ts`; restarts dashboard, **inherits parent env** |
| 9 | Flywheel autonomy (`auto_pickup_backlog`, `require_uat_before_merge`, `merge_train_enabled`) | runtime | SQLite `app_settings` | flywheel orchestrator + `auto-merge-policy.ts` |
| 10 | Deacon auto-start | boot | config `startup.auto_start` | `main.ts` |

**The conflations that cause pain:**
- **#1 alone means three things:** (a) "don't resume agents after this restart" (boot reconciliation), (b) "don't let the deacon re-dispatch/relaunch anything" (runtime suppression), (c) the de-facto "emergency stop for runaway." These are different decisions with different lifetimes.
- **#1 is stored in process env**, which is **lost on watchdog restart** (#8 inherits whatever the parent had). The dashboard "Resume all" button toggles env in-process only, so a watchdog restart silently reverts it → the death loop.
- **#2, #3, and "stop"** all "turn the deacon off" with different lifetimes and blast radii; an operator can't tell which one stopped a given action.
- **#5/#6** both block resume per-agent with no mutual exclusion or shared surface.

## The redesign

### Principle: six orthogonal concerns, each with one control, one door

| Concern (the operator's actual question) | The one control | Durable store | The one surface |
|---|---|---|---|
| "On restart, what happens to agents that were running?" | **Boot reconciliation** (grace + decision) | SQLite `control.boot_reconciliation` | boot banner/modal + `pan boot status` / `pan resume` |
| "Stop *everything* right now (runaway)." | **Freeze** (already #2) | SQLite `deacon.globally_paused` | big red dashboard kill-switch + `pan admin cloister freeze` |
| "How autonomous should steady state be?" | **Autonomy level** (#9) | SQLite `app_settings` | dashboard settings + `pan flywheel` |
| "Hold this one agent / issue." | **Scoped suppression** (#4/#5/#6 unified) | agent state / review_status | `pan pause`/`pan ignore`/`pan untroubled` |
| "Cap how much runs at once." | **Resource ceiling** (#7) | config | `pan admin cloister brake` |
| "Keep the system alive." | **Liveness recovery** (#8 watchdog + flywheel relaunch) | internal | automatic, capped |

Everything reads and writes these through one resolver/writer pair (the two-door tenet), so "why isn't X happening?" has one answer.

### Decision 1 — Retire no-resume-by-default; boot with a reconciliation **grace window**

This is the centerpiece and the thing you asked for. On dashboard boot:

1. Compute the **reconciliation set**: agents that were running before the restart (SQLite `agents` table) whose tmux sessions are now gone.
2. Enter a **grace window** (`startup.reconciliation_grace_secs`, default 30). During grace the deacon patrol runs (it's the recovery engine) but **holds its resume/dispatch actions for the reconciliation set**, and the flywheel is not auto-launched.
3. Show a **reconciliation modal/banner** (PAN-2076): *"N agents were running before the restart. Auto-resuming in 0:29 — [Resume all] · [Keep all stopped] · [Review each]."*
4. On expiry **or** [Resume all] → resume (the safe default; most restarts are benign). [Keep all stopped] → hold (the old no-resume outcome, now an explicit per-boot choice). [Review each] → per-agent disposition (PAN-2076).
5. **Record the decision durably in SQLite** so a watchdog restart mid- or post-grace does not lose it.

Result: resume-by-default becomes safe because the operator gets a window to abort and the brakes (#7) prevent a thundering herd — so **no-resume no longer needs to be the default**, which removes the entire death-loop class at the root.

### Decision 2 — `OVERDECK_NO_RESUME` becomes a boot **input**, not a runtime gate

It only pre-selects "[Keep all stopped]" / skips the grace at boot. It must **not** gate runtime behavior (flywheel relaunch, review re-dispatch, orphan recovery) — those are governed by Freeze and the scoped controls. (PAN-2160 already drew this line for the flywheel; this generalizes it.)

### Decision 3 — Emergency stop is **Freeze**, and only Freeze

The runaway-protection intent moves entirely to Freeze (`deacon.globally_paused`), which short-circuits the whole patrol → no dispatch, no resume, no relaunch. Make it a prominent dashboard kill-switch and document it as the single answer to "stop everything now." Runaway is otherwise prevented by purpose-built controls — the concurrency brakes (#7), per-agent troubled gates (#6), and the grace window — not by a sticky boot flag.

### Decision 4 — Move control state out of process env into the durable control plane

The resume/control decisions live in **SQLite `app_settings`** (durable), read by `boot-gates.ts` with an explicit-env override for one-shot operator intent. The watchdog restart then **reads the resolved state from SQLite** instead of inheriting ad-hoc env — fixing the "restart loses the toggle" bug for the general case (what we patched operationally with persistent-resume + the supervisor env). This is the single-source-of-truth tenet applied to control state.

### Decision 5 — One status surface

`pan boot status` (CLI, PAN-2078) and a dashboard panel show the **resolved state of every control**: frozen? resume mode? autonomy level? which agents paused/troubled? concurrency ceiling? in-grace? — so the operator never reasons across env + SQLite + state files again.

## What maps to what (this *is* PAN-2075)

This proposal is the architecture for the existing **Boot Reconciliation + Operator Inbox epic** ([PAN-2075](https://github.com/eltmon/overdeck/issues/2075)): the grace+modal is [PAN-2076](https://github.com/eltmon/overdeck/issues/2076), the CLI parity (`pan boot status` / `pan resume --all|--select|--freeze`) is [PAN-2078](https://github.com/eltmon/overdeck/issues/2078). The additions here are: the explicit **concern-separation table**, **Decision 2** (NO_RESUME demoted to a boot input), **Decision 4** (durable control plane / kill the env-loss bug), and the unification of the scoped controls.

## Decisions needed from the operator

1. **Default grace length** (proposed 30s) and whether the default expiry action is **Resume** (recommended) or **Hold**.
2. **Is Freeze the canonical emergency stop?** (recommended yes — make it the prominent kill-switch, retire NO_RESUME-as-emergency-stop.)
3. **Scope of first slice:** ship the grace+modal + durable resume state first (kills the death loops), then the unified status surface, then the scoped-control unification — or all under the PAN-2075 epic at once.

## Acceptance criteria (when this is built)

- Dashboard boot resumes prior agents **by default** after a grace window, with an operator abort; no-resume is no longer the default.
- A watchdog restart **preserves** the operator's resume/freeze decision (durable store), verified by a test that restarts with a flipped decision and asserts it survives.
- `OVERDECK_NO_RESUME` affects only the boot decision; a unit test asserts it does not gate runtime relaunch/dispatch.
- `pan boot status` prints the resolved state of all six controls.
- Freeze halts all dispatch/resume/relaunch in one action; documented as the emergency stop.
