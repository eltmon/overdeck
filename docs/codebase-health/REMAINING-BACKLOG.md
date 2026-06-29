# Codebase-Health — Remaining Backlog (after the first pass)

> The A–E roadmap's *named, highest-value* targets are landed and green. This is the honest
> "what's left" — and it corrects an overstatement: the decomposed god files were **substantially
> shrunk, not all taken below the god-file line.** The file-size guard permits the remainder because
> those files are *baselined to shrink-only* — green ≠ small.

## 1. Decompositions that are partial (shrunk, still large)

| File | Before | Now | Status |
| --- | ---: | ---: | --- |
| `App.tsx` | 1,927 | **789** | ✅ below 1k |
| `config-yaml.ts` | 3,012 | **7** (barrel) | ✅ done |
| `routes/workspaces.ts` | 6,638 | 1,736 | ~74% off, still >1k |
| `cloister/deacon.ts` | 7,180 | 3,381 | ~53% off, still large |
| `SettingsPage.tsx` | 4,200 | 2,043 | ~51% off, still >1k |
| `KanbanBoard.tsx` | 3,017 | ~1k-ish | reduced |
| `lib/agents.ts` | (large) | **4,572** | only 4 modules pulled — **bulk remains; highest-priority finish** |

The first pass extracted each file's *worst* seams; finishing them (further deep-module splits) is
follow-on work, not a fresh start — the seams + patterns are established.

## 2. God files never in scope (untouched, >1,000 lines)

These were not named A–E targets and are largely untouched (a few only had harness branches migrated):

- `routes/conversations.ts` **4,898** (only harness branches migrated, not decomposed)
- `routes/agents.ts` 4,071 · `routes/issues.ts` 4,065
- `cloister/service.ts` 2,039 · `routes/misc.ts` 1,835 · `cli/commands/workspace.ts` 1,791
- `routes/specialists.ts` 1,753 · `cloister/specialists.ts` 1,749 · `workspace-manager.ts` 1,736
- `database/schema.ts` 1,650 · `chat/MessagesTimeline.tsx` 1,620 · `services/conversation-service.ts` 1,609
- `CommandDeck/index.tsx` 1,540 · `overdeck/conversations.ts` 1,522 · `settings-api.ts` 1,488
- `services/issue-data-service.ts` 1,466 · `voice/*`, `supervisor/*`, `lib/workspace/*` (several)

(Run the survey for the live list: `git ls-files 'src/**/*.ts' 'src/**/*.tsx' | grep -vE '__tests__|\.test\.|\.d\.ts' | while read f; do n=$(wc -l <"$f"); [ "$n" -gt 1000 ] && echo "$n $f"; done | sort -rn`)

## 3. Foundations laid, not filled (deliberately "first step")

- **Epic C — evals:** a harness + one eval. Real behavior coverage across key surfaces is a large
  ongoing effort. The net exists; it isn't filled.
- **Two-door state model:** the *pattern* + CI guard are enforced, but legacy direct-access paths
  still coexist ("designed ≠ deleted"). Routing the remainder through the two doors is ongoing.

## 4. Epic D — Architect role + gating clarity (designed, not built)

Full design in `D-architect-and-gating-model.md`. Decisions locked (blocking-with-override,
large/risky only). **Paused at the right gate:** needs an *interactive mockup* of the proposed
gate-ladder UI before any production change (the current gating UX is hard-won), plus the 4 open
questions in that doc's §9.

## 5. Optional small cleanups
- `isValidHarness()` helper to DRY the ~5× allowed-harness validation (settings-api/config-yaml/start/handoff).
- Epic D Phase-1 mechanical gates (PRD-linked-PR check; no-loss-audit in CI).

## Suggested priority
1. **Finish `agents.ts`** (still 4,572 — the biggest remaining offender, and a backend hot path).
2. **`conversations.ts`** (4,898 — never decomposed; only harness-migrated).
3. Then the other route god files (`routes/agents.ts`, `routes/issues.ts`) and finish deacon/workspaces/SettingsPage.
4. Epic D after its mockup; evals + two-door migration as continuous background work the sequencer/Architect can schedule.
