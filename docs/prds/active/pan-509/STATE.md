# PAN-509 — Inspector: Phase-Aware Terminal

## Problem

`InspectorPanel` always streams the work-agent tmux session (`agent.id`) regardless of which pipeline phase is actually running. When review/test/merge specialists are executing, the Inspector shows an idle or stopped work agent. Users must know to leave the Inspector and hunt the specialist terminals elsewhere.

## Goal

The Inspector automatically surfaces the most relevant terminal for the current pipeline phase, with a visible phase indicator and a manual pin/override so users can stick on a specific terminal when they want to.

## Current architecture (observed)

- `InspectorPanel.tsx:117` receives `agent`, `issue`, `issueId` and an `onOpenTerminal` callback.
- `DetailPanelLayout.tsx:48` owns the two-pane layout (`inspector+terminal`) and constructs `<TerminalPanel key={agent.id} agent={agent} … />` — the terminal session name is hardwired to `agent.id`.
- `TerminalPanel.tsx` renders `<XTerminal sessionName={agent.id} />` (raw websocket at `/ws/terminal?session=<name>`).
- `XTerminal` is already session-agnostic — it accepts any `sessionName` prop and streams it (confirmed by `ConversationPanel.tsx:162` and `PlanDialog.tsx:861`).
- Review status (`reviewStatus`/`testStatus`/`mergeStatus`) is already fetched in `InspectorPanel.tsx:159` via `/api/workspaces/:issueId/review-status` and consumed by `ActionsSection.tsx`.
- Specialist tmux sessions follow `specialist-<projectKey>-<name>` for project-scoped specialists and `specialist-<name>` for global ones (`src/lib/cloister/specialists.ts:561`).
- Planning tmux session name is `planning-<issueId>` (per issue description).
- `/api/specialists` returns the list of specialists with their `tmuxSession` field (see `SpecialistAgentCard.tsx`).

**Good news:** no server work is needed. The `/ws/terminal` endpoint already streams any tmux session by name, and the data we need (phase, specialist session names) is already exposed by existing endpoints. This is a **frontend-only** change.

## Decision summary

1. **Derive phase on the client** from the already-fetched `reviewStatus` + agent status + planning state. Single hook `usePipelinePhase(issueId, agent, reviewStatus, planning)` returns `{ phase, activeSession, availableTerminals }`.
2. **Render a tab strip** at the top of the right-hand terminal pane (not the Inspector body) listing the relevant terminals for this issue: Planning, Work, Review, Test, Merge. The currently-active tab is auto-selected; completed phases stay clickable (history); future phases are disabled-but-visible.
3. **Manual pin** — clicking a tab while auto-follow is on pins that session and freezes auto-switching until the user clicks the "Auto" chip to release it. Pin state persists per-issue in `localStorage` (key: `pan-terminal-pin-<issueId>`).
4. **Session name resolution** happens client-side using the issue's `project.id` to construct `specialist-<projectKey>-<role>`. The frontend already knows the project from `issue.project.id`.
5. **Verification output** — the issue mentions quality gates (verification gate, PAN-174) may need a dedicated log stream. Current behavior: verification feedback is delivered directly into the work agent's tmux via `sendKeysAsync` (`ws-terminal.ts` + `tmux.ts`), so the work-agent tab already displays it. **For this feature we do NOT add a new log stream** — we simply keep the Work tab active during the `verifying` substate and tag the phase chip as "Verifying" so the user knows to watch there. A dedicated verification log stream is out of scope and tracked separately if needed.
6. **Merge ready / done** — show a lightweight summary card in the terminal pane instead of a live stream when `mergeStatus === 'merged'`. Falls back to the last-active specialist terminal if the tmux session still exists.

## Phase → session mapping

| Phase detected | Condition | Active tmux session |
|---|---|---|
| `planning` | planning agent running (optional; only if we can detect it) | `planning-<issueId>` |
| `working` | `agent.status === 'running'` and no specialist active | `<agent.id>` (work agent) |
| `verifying` | post-completion verification gate running | `<agent.id>` (feedback goes here) |
| `reviewing` | `reviewStatus.reviewStatus === 'reviewing'` | `specialist-<projectKey>-review-agent` |
| `review-feedback` | review failed, `agent.status === 'running'` | `<agent.id>` |
| `testing` | `reviewStatus.testStatus === 'testing'` | `specialist-<projectKey>-test-agent` |
| `merging` | `reviewStatus.mergeStatus` ∈ {`queued`,`merging`,`verifying`} | `specialist-<projectKey>-merge-agent` |
| `merged` | `reviewStatus.mergeStatus === 'merged'` | summary card (no stream) |

Precedence (first match wins, top-to-bottom): `merging` → `testing` → `reviewing` → `verifying` → `working` → `planning` → `merged`.

## Files to change

- `src/dashboard/frontend/src/components/inspector/usePipelinePhase.ts` — **new**. Derives phase + active session from inputs. Pure function (unit-testable).
- `src/dashboard/frontend/src/components/inspector/TerminalTabs.tsx` — **new**. Tab strip + auto/pin toggle + phase chip. Persists pin state to `localStorage`.
- `src/dashboard/frontend/src/components/inspector/MergedSummaryCard.tsx` — **new**. Small card shown when phase is `merged`.
- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — accept optional `sessionName` + `title` props (default to `agent.id` for back-compat); replace hardcoded `<XTerminal sessionName={agent.id} />`.
- `src/dashboard/frontend/src/components/DetailPanelLayout.tsx` — compute phase + active session via `usePipelinePhase`, render `<TerminalTabs>` above `<TerminalPanel sessionName={activeSession} …>`, gate the "merged" state on `MergedSummaryCard`.
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — expose a small phase badge in the header (reuse the existing `reviewStatus` query, don't add a second fetch). Minimal change: one badge component.
- `src/dashboard/frontend/src/components/inspector/usePipelinePhase.test.ts` — **new**. Unit tests covering the precedence table above.
- `src/dashboard/frontend/src/components/inspector/TerminalTabs.test.tsx` — **new**. Render tests for auto-follow, pinning, and persistence.

No backend changes. No new API routes. No new event types.

## Out of scope (explicit)

- Dedicated verification-output log stream (work agent tmux already receives verification feedback).
- Planning-phase auto-switching when the planning tab is active — planning uses its own dialog/flow (`PlanDialog.tsx`) and is launched separately; the Inspector isn't the right surface for the active planning terminal and `planning-<id>` may not exist at Inspector-view time. We still *expose* the Planning tab if a `planning-<id>` session exists (cheap check), but the phase arrow never points at it automatically.
- Server-side phase computation or a new `/api/issues/:id/phase` endpoint. All derivation is client-side from data we already fetch.
- Historical specialist terminal replay after a specialist session is destroyed. If the tmux session is gone, the tab is disabled with a tooltip "session ended".
- Uat-agent phase. UAT is not in the issue's phase table and its integration is still evolving; we'll add it opportunistically if the session name pattern holds, but it is not a deliverable.

## Risk / watch-outs

- **Project key resolution**: `specialist-<projectKey>-<role>` requires the canonical project key. Use `issue.project.id` (already on the issue object) but sanity-check against what `specialists.ts:561` actually uses (`projectKey` variable). If mismatch, fall back to fetching `/api/specialists` filtered by project and reading `tmuxSession` directly.
- **Stale sessions**: if the review-agent tmux session has been killed after completion, `/ws/terminal?session=...` will fail to connect. `XTerminal` already has reconnect logic — we must ensure it doesn't spin forever. Add a "session ended" empty state after N failed reconnects (~3s × 2 tries) and fall back to a one-shot GET of the last buffered output via `/api/agents/:id/activity` or `/api/specialists/:name/logs` if available.
- **Auto-switch churn**: if the phase flips rapidly (e.g., review → work → review during a feedback loop), tab auto-switching could disorient. Mitigation: debounce auto-switching by 1s; the user's pin always wins instantly.
- **Terminal pane not visible**: today `panelMode` can be `inspector-only` (user collapsed terminal). Auto-switching a hidden terminal is a no-op — when the user re-opens the terminal, it should open to the current phase, not the last-pinned session from a previous visit. Clear pin on terminal close? No — pin is a deliberate user choice and should survive. Instead: on re-open with `panelMode === 'inspector+terminal'`, honor the pin; the phase chip at the top shows what's active vs what's pinned.

## Difficulty

Medium. ~7 files, 1 pure hook, 2 new components, one layout rewire. No state-machine or backend changes. Standard React patterns.

## Testing strategy

- Unit: `usePipelinePhase` precedence table (vitest).
- Unit: `TerminalTabs` auto-follow + pin + localStorage persistence (vitest + @testing-library/react).
- Manual (work agent must verify): open the Inspector for an issue that's mid-review; confirm the terminal pane switches to the review-agent tmux; pin the work-agent tab; force a phase change; confirm it stays pinned; click "Auto"; confirm it follows again.
