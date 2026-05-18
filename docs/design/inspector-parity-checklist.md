# InspectorPanel Feature Parity Checklist

> **Scope:** InspectorPanel.tsx + all `inspector/*` sub-files vs. the new Issue Detail drawer (PRD §4.7.8).
> **Goal:** Every feature is mapped to (a) a drawer subsection, (b) another surface in the redesign, or (c) explicit out-of-scope with user-visible justification.

---

## 1. InspectorPanel.tsx — Shell & Inline Sections

| # | Feature | Current Location | Drawer Destination | Notes |
|---|---|---|---|---|
| 1.1 | Issue ID header with live pulse dots (agent running indicator) | Header row | **Drawer header** — phase timeline + ID chip | Pulse dots become the verb badge on the active-agent card |
| 1.2 | Phase chip (planning/working/reviewing/etc.) | Header row | **Drawer header** — phase timeline | The old inline chip becomes the current step in the 6-step timeline |
| 1.3 | Close inspector button | Header row | **Drawer chrome** — X button + Esc + click-scrim | Unified close surface per PRD §4.7.8 |
| 1.4 | Open terminal button | Header row | **(b) Terminal tab** | Terminal is a first-class tab, not a sidebar button |
| 1.5 | Issue title, status badge, priority, first-2 labels | Title block below header | **Drawer header** — title + meta row | Labels stay neutral per style guide; priority renders as left-bar heat |
| 1.6 | TTS mute/unmute toggle per issue | Title block | **(c) Out of scope** | TTS muting is a global user preference, not issue-scoped data. Justification: moving to Settings (Observability) as a single global toggle avoids per-issue noise in the drawer |
| 1.7 | Assignee name + email | Inline row | **Drawer header meta row** | Email via `SensitiveText` preserved |
| 1.8 | Pipeline stuck banner (alert + RecoverButton) | Inline alert banner | **Overview tab** — alert banner above active-agent card | "Pipeline Stuck" is a first-class alert state |
| 1.9 | Pending review stranded banner (age + re-request button) | Inline alert banner | **Overview tab** — alert banner | Preserved verbatim as a recoverable stuck state |
| 1.10 | Merged status banner (no workspace, merged label) | Inline banner | **Terminal tab** — `MergedSummaryCard` | When merged with no active terminal, Terminal tab shows the merged card |
| 1.11 | "No workspace yet" message + Plan/Create Workspace CTA | Inline message | **Overview tab** — empty-state CTA | Consolidated into the action bar + active-agent card empty state |
| 1.12 | Workspace stack broken warning | Inline alert banner | **Overview tab** — alert banner | Critical health signal, preserved |
| 1.13 | Awaiting input banner (title, prompt preview, attach-terminal button) | Inline alert banner | **Overview tab** — active-agent card "Tell input" row | Part of the stream-excerpt panel per PRD §4.7.8 |
| 1.14 | Activity summary (session count + last activity age) | Inline section | **Activity tab** + **side rail** | Activity tab is canonical; side rail shows live stream items |
| 1.15 | Swarm slots pills (attachable state, label, dot) | Inline section | **Overview tab** — active-agent card meta | Swarm slots nest under the parent agent in the drawer |
| 1.16 | Reviewer summary grid (5 roles: cor/sec/per/req/syn) | Inline section | **Overview tab** — "Review specialists" card | PRD §4.7.8 explicitly lists review specialist verdict rows |
| 1.17 | PR link / status / additions / deletions / reviewDecision | Inline section | **Overview tab** + **Action bar "View PR"** | PR metadata lives in Overview; action bar has the external link |
| 1.18 | Links section (GitHub/Linear issue, PRD) | Inline section | **Overview tab** — compact link row | PRD link also reachable from Plan tab |
| 1.19 | Cost summary (total, input/output tokens, by model, by stage) | Inline section | **Drawer header meta row** (total) + **Overview tab** (breakdown) | Currency always uses `signal-cost-foreground`; by-model/stage detail in Overview |
| 1.20 | Workspace corrupted warning + Clean & Recreate button | Inline alert banner | **Overview tab** — alert banner + action bar | Danger-zone action or inline recovery CTA |
| 1.21 | Service URLs (frontend, API) | Inline section | **Overview tab** — link row | Preserved |
| 1.22 | Start containers button (when hasDocker + stopped/missing) | Inline section | **Overview tab** — container card footer | Container section retains start action |
| 1.23 | Git-only workspace + Containerize button | Inline section | **Overview tab** — container card footer | Preserved |
| 1.24 | Tmux attach command with copy-to-clipboard | Inline section | **(c) Out of scope** | The drawer Terminal tab uses live PTY (`/ws/terminal`), not manual tmux copy-paste. Justification: the Terminal tab is the replacement surface; copy-pasting a tmux command is a fallback for when PTY is unavailable, which the new design does not optimize for |
| 1.25 | Salvageable stashes list (ref, description, date, recover, dismiss) | Inline section | **Overview tab** — stash card | Preserved with recover/dismiss actions |
| 1.26 | Issue labels overflow (3+ labels, no-agent view) | Bottom inline section | **Drawer header meta row** | All labels shown in header chips, not truncated |
| 1.27 | `embedded` mode (no border-r, no close btn) | Shell prop | **(c) Out of scope** | The drawer is always a slide-out shell; `embedded` was used by PlanDialog to show inspector inline. PlanDialog will continue to need an inline project-planning view, but that is not the Issue Detail drawer — it may keep a stripped-down inline variant or be redesigned separately. Justification: embedded mode is a host-shell concern, not a drawer feature; PlanDialog's inline planning view is out of scope for PAN-1148 |
| 1.28 | PRD modal viewer (ReactMarkdown + rehypeSanitize) | Modal overlay | **Plan tab** | The PRD is a first-class tab, not a modal |
| 1.29 | Beads dialog (`BeadsDialog`) | Modal overlay | **Beads tab** | Beads are a first-class tab, not a modal |
| 1.30 | vBRIEF dialog (`VBriefDialog`) | Modal overlay | **Plan tab** | vBRIEF viewer consolidated into Plan tab |
| 1.31 | Plan dialog (`PlanDialog`) | Modal overlay | **Plan tab** — planning launcher | Planning CTA launches the planning flow inline or in a modal; the Plan tab shows plan state |
| 1.32 | Switch Model modal (`SwitchModelModal`) | Modal overlay | **Overview tab** — model switcher inline or action-bar dropdown | The modal becomes an inline picker or dropdown to avoid modal stacking |

---

## 2. AgentInfoSection.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 2.1 | Agent model display (friendly name via `getFriendlyModelName`) | **Overview tab** — active-agent card meta row | Preserved |
| 2.2 | Runtime/harness display (via `getHarness`) | **Overview tab** — active-agent card meta row | Preserved |
| 2.3 | Agent uptime/duration | **Overview tab** — active-agent card meta row | Preserved |
| 2.4 | Agent session ID (mono) | **Overview tab** — active-agent card meta row | Preserved |
| 2.5 | Git branch + uncommitted files count + latest commit | **Files tab** | Git status moves to Files tab per drawer IA |
| 2.6 | Sync Main button | **Files tab** | Git operation belongs in Files tab |
| 2.7 | Workspace path with VS Code link + `PanOpenInPicker` | **Overview tab** — active-agent card footer link | Preserved |
| 2.8 | Workspace location badge (local/remote) | **Overview tab** — active-agent card meta | Preserved |

---

## 3. ReviewPipelineSection.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 3.1 | Pipeline stepper (Build Gate → Review → Tests → Merge) | **Overview tab** — verification gates card | PRD §4.7.8 specifies 4 verification gate cards (typecheck/lint/test/UAT) |
| 3.2 | Stale indicator (last updated > 30 min) | **Overview tab** — gate card sub-text | Preserved as muted timestamp |
| 3.3 | Auto-requeue counter (`autoRequeueCount` / 7 max) | **Overview tab** — gate card or alert banner | Preserved; human-review flag at max |
| 3.4 | Merge retry counter (`mergeRetryCount` / 3 max) | **Overview tab** — merge gate card | Preserved |
| 3.5 | Verification cycle counter (`verificationCycleCount` / max) | **Overview tab** — build gate card | Preserved |
| 3.6 | CI check sub-statuses (statusCheckRollup during merge) | **Overview tab** — merge gate card detail | Preserved as check pills |
| 3.7 | Merge queue position | **Overview tab** — merge gate card | Preserved |
| 3.8 | Live specialist log link (during queued/merging/verifying) | **Terminal tab** — auto-select merge session | Opening the merge session in Terminal tab replaces the log link |
| 3.9 | Collapsible failure details (notes per step, ReactMarkdown) | **Overview tab** — gate card expand/collapse | Preserved |
| 3.10 | Previous attempts history (`StatusHistory`) | **Activity tab** | Historical timeline belongs in Activity |

---

## 4. ContainerSection.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 4.1 | Container status chips (name, running, health, uptime) | **Overview tab** — container card | Preserved as status pills |
| 4.2 | Container expand/collapse for probe details (ports, lastProbeAt, lastFailureReason) | **Overview tab** — container card expand | Preserved |
| 4.3 | Container context menu (right-click → start/stop/restart) | **Overview tab** — container card context menu | Preserved; click vs. right-click TBD by drawer implementation |
| 4.4 | Refresh DB action (postgres-only, destructive confirm) | **Overview tab** — container card context menu | Preserved |
| 4.5 | Click-outside-to-dismiss for context menu | **Overview tab** — container card | Preserved via standard popover/dismiss pattern |

---

## 5. ActionsSection.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 5.1 | Workspace Actions group header | **Action bar** (drawer footer) | Actions consolidated into the sticky footer per PRD §4.7.8 |
| 5.2 | Issue Actions group header | **Action bar** | Same consolidation |
| 5.3 | Pending operation status (merge in progress spinner, failed + dismiss) | **Overview tab** — alert banner + action bar | Transient state shown inline; failed state is dismissible |
| 5.4 | Review pipeline status inline (embedded `ReviewPipelineSection`) | **Overview tab** — verification gates | This is the inline duplication of ReviewPipelineSection; drawer deduplicates into Overview |
| 5.5 | Review action hint banner (next-step guidance) | **Overview tab** — alert banner | Preserved as contextual guidance |
| 5.6 | Merge button | **Action bar** — primary "Merge to main" | Uses `success` background per PRD §4.7.8 |
| 5.7 | "Merged" status pill | **Drawer header** — phase timeline | Terminal state in timeline |
| 5.8 | Review & Test button (start/re-run/re-request, with loading states) | **Action bar** | Preserved with all state variants |
| 5.9 | Stop Agent button | **Action bar** | Preserved |
| 5.10 | Switch Model button | **Action bar** or **Overview tab** — active-agent card | Likely action bar for consistency |
| 5.11 | Recover button (stuck pipeline) | **Action bar** | Preserved |
| 5.12 | Start/Resume Agent button (with lifecycle-driven label: Start/Resume/Checking) | **Action bar** | Preserved; harness picker adjacent |
| 5.13 | Resume with different model dropdown | **Action bar** — inline dropdown | Replaces the separate Switch Model modal flow |
| 5.14 | Harness picker (`HarnessSelect`) for new starts | **Action bar** | Preserved |
| 5.15 | Reset Session button | **Action bar** — ghost button | Preserved |
| 5.16 | Create Workspace button | **Action bar** or **Overview** empty-state | Shown when no workspace exists |
| 5.17 | Copy Settings button | **(c) Out of scope** | Copies global Panopticon settings into workspace. Justification: this is a workspace-admin operation, not an issue-inspection operation. Moved to Settings or a dedicated workspace-admin surface to keep the drawer focused on issue state, not workspace bootstrapping |
| 5.18 | Feature-only Plan / See Plan button | **Plan tab** | Planning CTA lives in the Plan tab |
| 5.19 | Resume message input textarea (Ctrl+Enter to send, Escape to cancel) | **Overview tab** — active-agent card "Tell input" | PRD §4.7.8 specifies 32px input + Send button in the active-agent card |
| 5.20 | Danger Zone: Reopen issue | **Overview tab** — collapsed danger zone | Preserved; may move to action-bar overflow |
| 5.21 | Danger Zone: Restart from Plan (`RestartFromPlanButton`) | **Overview tab** — danger zone | Preserved |
| 5.22 | Danger Zone: Reset Issue (`ResetIssueButton`) | **Overview tab** — danger zone | Preserved |
| 5.23 | Danger Zone: Cancel Issue | **Overview tab** — danger zone | Preserved |
| 5.24 | Mutation error/success toasts (review, start, sync, copy) | **(b) Global toast system** | `sonner` toasts are global, not drawer-specific; preserved |
| 5.25 | ArtifactLinks (view beads, view vBRIEF) | **Beads tab** + **Plan tab** | Replaced by first-class tabs |

---

## 6. MergedSummaryCard.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 6.1 | Merged badge with timestamp | **Terminal tab** — merged state card | Shown when phase=merged and no pinned session |
| 6.2 | Total cost pill | **Terminal tab** — merged card detail | Preserved |
| 6.3 | PR link pill | **Terminal tab** — merged card detail | Preserved |
| 6.4 | View last specialist log button | **Terminal tab** — merged card action | Auto-selects merge session in Terminal tab |

---

## 7. StatusHistory.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 7.1 | Previous attempts expandable list (type, status, timestamp, notes snippet) | **Activity tab** | Historical timeline belongs in Activity per drawer IA |

---

## 8. TerminalTabs.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 8.1 | Phase chip in terminal header (colored per phase) | **Terminal tab** — tab bar | Preserved as the active-session indicator |
| 8.2 | Session tab buttons (planning/working/reviewing/testing/merging) | **Terminal tab** — tab bar | Preserved; sessions mapped to agent roles |
| 8.3 | Active session dot indicator | **Terminal tab** — tab bar | Preserved |
| 8.4 | Running spinner on active tab | **Terminal tab** — tab bar | Preserved |
| 8.5 | Pin/Auto toggle (localStorage persistence) | **Terminal tab** — tab bar | Preserved; pin state stored per issue |
| 8.6 | `PHASE_CHIP_COLORS` / `PHASE_LABELS` tokens | **(b) Global primitives** | These token maps move to the shared primitive system; the old hardcoded hex values are replaced by style-guide tokens |

---

## 9. TerminalSessionWrapper.tsx

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 9.1 | Session ended state (WiFi off icon, session name, retry button) | **Terminal tab** — disconnected state | Preserved |
| 9.2 | Retry connection button | **Terminal tab** — disconnected state | Preserved |
| 9.3 | `XTerminal` PTY rendering | **Terminal tab** — main panel | Reuses existing `XTerminal` component verbatim |

---

## 10. DetailPanelLayout Concerns (Parent Shell, Not in `inspector/*`)

The following are owned by `DetailPanelLayout.tsx` and are noted here for completeness because they affect the user-visible feature set, but they are outside the `inspector/*` scope of this audit:

| # | Feature | Drawer Destination | Notes |
|---|---|---|---|
| 10.1 | Resizable panel drag handle | **Drawer chrome** — 980px fixed-width slide-out | The drawer has a fixed max-width, not user-resizable |
| 10.2 | Inspector/Terminal split (`react-resizable-panels`) | **Drawer body grid** — 1fr + 320px side rail | The drawer uses a fixed main/rail split, not a resizable panel group |
| 10.3 | Panel mode persistence (`inspector-only` / `inspector+terminal`) | **(c) Out of scope** | The drawer always renders tabs; Terminal is one tab. There is no "terminal hidden" mode because tabs replace the split layout. Justification: the tab model replaces the split-panel model; users choose tabs instead of resizing panels |
| 10.4 | Panel width persistence in `localStorage` | **(c) Out of scope** | Drawer width is fixed by design (980px max). Justification: the drawer is a standard slide-out with fixed dimensions per PRD §4.7.8 |
| 10.5 | `onViewMergeLog` callback (auto-select merge tab + open terminal) | **Terminal tab** — auto-select merge session | Preserved as a programmatic tab switch |

---

## 11. Summary: Out-of-Scope Items with Rationale

| # | Feature | Rationale (User-Visible) |
|---|---|---|
| 1.6 | TTS mute/unmute toggle per issue | Moving to Settings as a global preference. Per-issue TTS muting added noise to the inspector; a single global toggle is simpler and achieves the same goal. |
| 1.24 | Tmux attach command with copy-to-clipboard | The Terminal tab provides live PTY streaming. Manual tmux copy-paste was a workaround for lacking integrated terminal access; the drawer solves this natively. |
| 1.27 | `embedded` mode (no chrome) | The drawer is always a slide-out shell. PlanDialog's inline planning view is a separate surface outside PAN-1148 scope; it may retain a stripped inline view or be redesigned later. |
| 5.17 | Copy Settings button | Workspace bootstrapping (copying global Panopticon settings into a workspace) is an admin operation, not issue-inspection. Moved to Settings or workspace-admin to keep the drawer focused on issue state. |
| 10.3 | Panel mode persistence (inspector-only vs inspector+terminal) | The tab model (Overview/Plan/Beads/Conversation/Terminal/Activity/Files) replaces the split-panel model. Users navigate by tabs, not by resizing panels. |
| 10.4 | Panel width persistence | Drawer width is fixed at 980px max per the design spec. No user resizing. |

---

## 12. Cross-Cutting Data & Mutations

All data sources and mutations used by InspectorPanel are preserved in the drawer. No endpoints are removed.

| Data / Mutation | Current Use | Drawer Use |
|---|---|---|
| `agent-session` lifecycle query | Resume vs. start semantics | Active-agent card state |
| `workspace` query | Containers, path, costs, stashes, stack health | Overview tab |
| `review-status` query | Pipeline stepper, history | Overview tab + Activity tab |
| `prd` query | PRD modal | Plan tab |
| `activity` query | Session count, last activity, reviewer sections | Activity tab + Overview |
| `pr` query | PR link, status, checks | Overview tab |
| `issueCosts` query | Total cost | Drawer header + Overview |
| `startAgent` mutation | Start/Resume | Action bar |
| `createWorkspace` mutation | Create workspace | Action bar / empty state |
| `startContainers` mutation | Start Docker containers | Container card |
| `containerControl` mutation | Start/stop/restart container | Container context menu |
| `containerize` mutation | Convert git-only to Docker | Container card |
| `review` mutation | Trigger review pipeline | Action bar |
| `cancel` mutation | Cancel issue | Danger zone |
| `reopen` mutation | Reopen issue | Danger zone |
| `resetSession` mutation | Reset agent session | Action bar |
| `switchModel` mutation | Change agent model | Action bar / active-agent card |
| `syncMain` mutation | Sync main into branch | Files tab |
| `refreshDb` mutation | Refresh postgres DB | Container context menu |
| `copySettings` mutation | Copy global settings to workspace | **(c) Out of scope** — see §11 |
| `recoverStash` / `dismissStash` mutations | Salvageable stash ops | Overview tab stash card |
| `dismissPending` mutation | Dismiss failed pending op | Alert banner dismiss |
| `clean` mutation | Clean corrupted workspace | Danger zone / alert banner |

---

*Checklist produced by wave 0, slot 1 of PAN-1148 swarm. Gates `i2-inspector-panel-retirement`.*
