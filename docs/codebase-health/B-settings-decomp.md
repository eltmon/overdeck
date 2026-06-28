# B (wave 3) — Decompose `SettingsPage.tsx` (frontend god component)

**Epic:** B · **Branch:** `codebase-health/settings-decomp` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per seam; the orchestrator reviews + merges.

---

## Goal
Behavior-preserving decomposition of `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx` (~4,200 lines) into hooks + section components. Extract the seams below in **safest-first order**, **commit per seam**, verify after each. If context runs low, stop after the last fully-committed seam and report what remains — partial is fine (each seam is independently valuable).

## Seams (recommended order: 1 → 5 → 2 → 3 → 4 → 6 → 7)
| # | New file | What moves | Risk |
|---|---|---|---|
| 1 | `Settings/hooks/useAutosavePipeline.ts` | debounced/queued autosave: the 6 save refs + `saveStatus` + `scheduleAutosave`/`drainSaveQueue`/`flushAutosave` + unmount cleanup | LOW |
| 5 | `Settings/sections/VoiceSettingsSection.tsx` | the Voice section JSX + `handleVoice*`/`handleMoonshine*`/`handleGoogleCloud*`/`handleAutoPreso*`/`handleVoiceHardware*` + `showVoiceApiKey` | LOW |
| 2 | `Settings/hooks/useConversationSearch.ts` | conv-search state cluster (13 states) + `conversation-search-status` query + reindex mutation + its handlers + effects | MED |
| 3 | `Settings/sections/ConversationSearchSection.tsx` | the conversation-search JSX block (lines ~2672–2949) + `ReindexConfirmDialog` wiring | MED |
| 4 | `Settings/sections/ProviderManagementSection.tsx` | provider list/expansion JSX + `handleProvider*`/`handleApiKeyChange`/`handleTestApiKey`/`handleTestModel` + their UI state | MED-HIGH |
| 6 | `Settings/sections/TtsConfigurationSection.tsx` | TTS section JSX + `handleTts*` + the tab sub-components wiring | MED |
| 7 | `Settings/sections/ConversationSettingsSection.tsx` | compaction/title/compact-mode/rich-summary controls + their handlers | LOW |

(The full analysis with interfaces, props, and gotchas was produced by the codebase analysis — follow its prop contracts; keep shared state like `formData` lifted in `SettingsPage` and thread it down. Keep query hooks + dialog state owned by `SettingsPage`; extracted pieces are presenters/hooks.)

## Requirements
**FR-1** Each seam in its own file; `SettingsPage` imports + uses it; the rendered Settings UI is unchanged (same controls, same behavior).
**FR-2** Each seam a separate commit (`refactor(dashboard): extract <seam> from SettingsPage`).
**FR-3** After each seam: `npm run build` (builds the frontend via Vite — catches import/type/bundling breakage) + `npm run lint` pass; the frontend Settings tests pass (`grep -rl Settings src/dashboard/frontend/src -i` to find them; run via the frontend vitest).

**NFR-1** Behavior-preserving only — no logic edits, no UX changes, no renames.
**NFR-2** A1 ratchet: no NEW explicit `any`. For `any` that MOVES with extracted code, add the new file(s) to `eslint-any-allowlist.json` (don't convert — separate cleanup).
**NFR-3** File-size guard: every new file must be < 1,000 lines (all proposed seams are; if one would exceed, split it).
**NFR-4** Don't break React hook rules (hooks at top level; extracted hooks called unconditionally).

## Verification (after EACH seam)
```
npm run build && npm run lint
# frontend Settings tests (adjust to the actual test paths):
npm --prefix src/dashboard/frontend run test -- $(grep -rl -i settings src/dashboard/frontend/src/__tests__ 2>/dev/null | tr '\n' ' ')
```

## Acceptance criteria
- Seams extracted (as many as context allows, safest-first); `SettingsPage.tsx` materially smaller.
- `npm run build` + `npm run lint` exit 0; Settings tests green.
- Each seam's diff is a behavior-preserving move (+ allowlist entries for moved `any`).
- If stopped early, a clear note of which seams are done vs remaining.

## Intersecting rules (restated)
No bandaids; surgical/behavior-preserving; A1 ratchet (moved `any` → allowlist, no NEW any); file-size guard (<1000/new file); React hook rules; worktree discipline (branch = `codebase-health/settings-decomp`; never `git checkout <branch>`/`git stash`); conventional commits (lowercase subject — commitlint rejects start-case), never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers/early-stop to the orchestrator.

## Out of scope
Any UX/logic change; the smaller leftover sections (Memory/Background-AI/Permissions/Diff/Experimental) — those are a later pass if context runs out.
