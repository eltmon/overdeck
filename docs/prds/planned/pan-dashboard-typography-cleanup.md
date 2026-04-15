# Panopticon dashboard typography cleanup

## Context

Panopticon's dashboard typography has drifted into multiple competing systems. The global app shell already points toward the intended direction (`DM Sans` for body/UI, `Space Grotesk` for display, `SF Mono` for technical strings), but Mission Control/Command Deck still carries a separate typography island and several dashboard surfaces use `font-display` or hardcoded font stacks outside the intended boundary. This creates visible inconsistency across left navigation, list views, metrics, and especially conversations.

The goal of this work is a complete typography cleanup across the non–God View dashboard so there is one canonical rule set:

- **DM Sans** = universal app sans for all non–God View UI
- **SF Mono** = technical strings, code, terminal, identifiers
- **Sidebar wordmark** = the only allowed non–God View display-font exception
- **Conversations** = entirely DM Sans except inline code / fenced code blocks / clearly technical strings
- **God View** = explicit typography exception; do not normalize it in this issue

This cleanup must also update Panopticon's documentation/style guide so future work does not drift again.

## Recommended approach

### 1. Make the frontend typography contract explicit and centralized

Use the existing frontend typography foundation as the source of truth rather than introducing new font systems.

#### Canonical sources to retain and normalize around
- `src/dashboard/frontend/tailwind.config.js`
  - `fontFamily.display` → Space Grotesk
  - `fontFamily.body` → DM Sans
  - `fontFamily.mono` → SF Mono stack
- `src/dashboard/frontend/src/index.css`
  - `body` already set to DM Sans
- `src/dashboard/frontend/index.html`
  - already loads DM Sans + Space Grotesk

#### Required outcome
- No non–God View surface should define its own unrelated sans stack.
- Components should use semantic font utilities/tokens, not ad hoc `font-family` strings.
- If CSS modules need local tokens, they should point to the same canonical stacks.

### 2. Remove the Mission Control / conversation typography island

This is the biggest source of inconsistency and the highest-priority implementation area.

#### Critical file
- `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`

#### Problems found
- `--mc-font-family` currently points to `-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro', system-ui, sans-serif`
- `.chatMarkdown` hardcodes `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- conversation list titles are mono by default (`.conversationName`)
- several Mission Control surfaces are using local font definitions rather than inheriting the canonical dashboard typography

#### Required changes
- Replace `--mc-font-family` with the canonical DM Sans stack
- Keep `--mc-font-mono` aligned to canonical SF Mono stack
- Remove hardcoded system sans overrides in conversation markdown
- Normalize conversation UI chrome, prose, lists, controls, and metadata to DM Sans unless content is truly technical

### 3. Normalize conversations end-to-end

Conversations need to become visibly uniform and match the policy exactly.

#### Critical files
- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx`
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`
- `src/dashboard/frontend/src/components/chat/ChatMarkdown.tsx`
- `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
- `src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx`
- `src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx`
- `src/dashboard/frontend/src/components/chat/DraftConversationPanel.tsx`

#### Required conversation rules
- **User message prose** → DM Sans
- **Assistant message prose/markdown** → DM Sans
- **Markdown headings/lists/tables/blockquote text** → DM Sans
- **Inline code / fenced code blocks** → SF Mono
- **Technical identifiers** (session IDs, file paths, hashes, model IDs, issue IDs when shown as identifiers) → SF Mono
- **Conversation list titles** should be evaluated and normalized to DM Sans unless there is a very strong reason to treat them as technical identifiers; the current default mono styling is likely part of the drift and should be removed
- **Conversation timestamps and metadata** should default to DM Sans unless the specific value is intentionally technical

#### Specific cleanup targets already identified
- `mission-control.module.css:.chatMarkdown`
- `mission-control.module.css:.conversationName`
- `mission-control.module.css:.userMessageText`
- `mission-control.module.css` message metadata / controls / headers / inputs

### 4. Restrict display-font usage to the exact approved boundary

The implementation should be stricter than the current style guide so future work is unambiguous.

#### Allowed non–God View use
- the upper-left `Panopticon` wordmark in `src/dashboard/frontend/src/components/Sidebar.tsx`

#### Default rule
- Ordinary page headings, section headings, metric values, card titles, labels, nav items, dialogs, buttons, tables, forms, and all other non–God View UI should use DM Sans

#### God View exception
- `src/dashboard/frontend/src/components/GodView/*` keeps its own scoped typography system for aesthetic reasons and is out of scope for this cleanup

#### Known non-God-View places to audit/change
- `src/dashboard/frontend/src/components/Sidebar.tsx`
  - keep only the `Panopticon` wordmark as the deliberate non–God View exception; nav labels remain sans
- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx`
  - convert `font-display` page title to DM Sans
- `src/dashboard/frontend/src/components/MetricsSummaryRow.tsx`
  - convert `font-display` metric values to DM Sans

#### Sweep requirement
Search for all non–God View `font-display` usage and enforce this rule:
- keep only the sidebar `Panopticon` wordmark
- convert every other non–God View use to DM Sans

### 5. Preserve SF Mono only for semantically technical surfaces

Mono should remain, but only where it communicates “machine/technical string,” not as decorative styling.

#### Keep mono for
- code blocks and inline code
- terminal output
- command snippets
- issue IDs / run IDs / session IDs when presented as identifiers
- file paths, env vars, hashes, model IDs, branch names, tool names, vBRIEF IDs

#### Critical technical-surface files to normalize
- `src/dashboard/frontend/src/components/XTerminal.tsx`
  - currently uses an ad hoc mono stack (`Menlo, Monaco, "Courier New", monospace`); replace with the canonical SF Mono stack
- `src/dashboard/frontend/src/index.css`
  - ensure `.terminal-output` and any global mono surfaces match the canonical stack
- `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`
  - preserve mono only in technical sub-elements, not general list/message prose

### 6. Sweep the rest of the non–God View dashboard for drift

Do a repo-wide audit for explicit font declarations and semantic-font misuse across dashboard/frontend.

#### High-value files/surfaces to audit during execution
- `src/dashboard/frontend/src/App.tsx`
- `src/dashboard/frontend/src/components/KanbanBoard.tsx`
- `src/dashboard/frontend/src/components/InspectorPanel.tsx`
- `src/dashboard/frontend/src/components/ActivityPanel.tsx`
- `src/dashboard/frontend/src/components/AgentList.tsx`
- `src/dashboard/frontend/src/components/AgentDetailView.tsx`
- `src/dashboard/frontend/src/components/CostsPage.tsx`
- `src/dashboard/frontend/src/components/MetricsPage.tsx`
- `src/dashboard/frontend/src/components/HealthDashboard.tsx`
- `src/dashboard/frontend/src/components/PlanDialog.tsx`
- `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx`
- `src/dashboard/frontend/src/components/vbrief/VBriefHeader.tsx`
- `src/dashboard/frontend/src/components/vbrief/VBriefViewer.tsx`
- `src/dashboard/frontend/src/pages/SpecialistDetail.tsx`

#### Sweep rule
- remove hardcoded sans stacks that bypass the canonical fonts
- preserve or add mono only when content is clearly technical
- remove decorative mono usage on normal UI labels/titles
- leave all `src/dashboard/frontend/src/components/GodView/*` files untouched

### 7. Update documentation so the codebase does not drift again

#### Must update
- `design/style-guide/STYLE-GUIDE.md`
  - make this the canonical typography policy
  - rewrite the typography section to match the final rule set exactly
  - explicitly define the conversation typography rule
  - explicitly define the God View exception
  - remove ambiguous heuristics like “use judgment if the heading has a g” and replace with crisp boundaries
- `docs/prds/active/pan-460/STATE.md`
  - align the recorded typography boundary with the final implementation if it currently conflicts

#### Should review/update if needed
- `design/prd/PRD-REBRAND.md`
- `docs/SETTINGS-UI-DESIGN.md`
- `docs/MISSION-CONTROL.md`

#### Documentation rule to encode
- default non–God View dashboard UI = DM Sans
- technical strings/code = SF Mono
- sidebar `Panopticon` wordmark = the only approved non–God View display-font exception
- conversations = DM Sans prose, SF Mono only for code/technical strings
- God View uses its own scoped typography system and is not governed by the general dashboard cleanup

### 8. Verification plan

#### Static verification
Run searches after implementation to confirm:
- no non–God View ad hoc sans stacks remain (`Inter`, `SF Pro`, raw system stacks in Mission Control, etc.)
- no non–God View inappropriate `font-display` use remains
- no ad hoc mono stacks remain where canonical SF Mono should be used
- conversation markdown prose no longer uses a separate hardcoded system font stack

#### Functional/visual verification
Run the dashboard and verify the following surfaces in-browser:
- left sidebar nav
- command deck / Mission Control shell
- conversation list
- conversation header
- user messages
- assistant markdown messages
- composer/editor
- metrics row
- awaiting merge page
- settings page
- kanban / inspector / detail panels with IDs and technical strings

#### Playwright verification
Use Playwright MCP to verify key golden-path surfaces visually, especially:
- conversation list typography vs conversation panel typography
- inline code and fenced code blocks in conversations
- sidebar wordmark vs standard nav labels
- metrics row after display-font cleanup
- light and dark mode consistency

#### Test/build verification
Use the standard dashboard quality gates after changes:
- frontend typecheck / project typecheck
- lint
- relevant frontend tests for conversation UI if snapshots/assertions need updates

## Critical files to modify

### Typography foundation
- `src/dashboard/frontend/tailwind.config.js`
- `src/dashboard/frontend/src/index.css`
- `src/dashboard/frontend/index.html`

### Mission Control / conversations
- `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`
- `src/dashboard/frontend/src/components/MissionControl/ConversationList.tsx`
- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx`
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`
- `src/dashboard/frontend/src/components/chat/ChatMarkdown.tsx`
- `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`
- `src/dashboard/frontend/src/components/chat/ComposerPromptEditor.tsx`
- `src/dashboard/frontend/src/components/chat/DraftConversationPanel.tsx`

### Other non–God View surfaces to audit/normalize
- `src/dashboard/frontend/src/components/Sidebar.tsx`
- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx`
- `src/dashboard/frontend/src/components/MetricsSummaryRow.tsx`
- `src/dashboard/frontend/src/components/XTerminal.tsx`
- plus any other non–God View dashboard component surfaced by the repo-wide font audit

### Documentation
- `design/style-guide/STYLE-GUIDE.md`
- `docs/prds/active/pan-460/STATE.md`
- `design/prd/PRD-REBRAND.md` (if needed for alignment)
- `docs/MISSION-CONTROL.md` / `docs/SETTINGS-UI-DESIGN.md` if they conflict with the final style guide

## Existing code/patterns to reuse

- canonical font definitions already present in `src/dashboard/frontend/tailwind.config.js`
- global DM Sans body default already present in `src/dashboard/frontend/src/index.css`
- font loading already present in `src/dashboard/frontend/index.html`
- scoped God View typography system in `src/dashboard/frontend/src/components/GodView/theme.css` should be left intact as the explicit exception

## Execution notes

- Do not touch `src/dashboard/frontend/src/components/GodView/*` typography
- Favor semantic font utilities/tokens over hardcoded font stacks
- Preserve mono for actual technical strings; do not flatten everything to sans
- Be especially careful with conversation list titles and work-log detail rows: distinguish human-readable prose from machine-oriented identifiers
