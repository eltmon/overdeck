# Overdeck CLI Backlog Triage Report

**Date:** 2026-04-30
**Version:** 0.8.1
**Open issues at start:** 232
**Methodology:** Four parallel analysis agents audited the full backlog against the current codebase (git log, grep, file existence). Each issue was checked for: whether a fix already exists on main, whether it duplicates another issue, whether it's been superseded by architectural changes, and whether it's stale research with no traction.

---

## Part 1: Issues to Close (43 issues)

### Already Fixed / Shipped (14)

These have verified fixes on `main` — the work is done, the issue was never closed.

| # | Title | Evidence |
|---|-------|----------|
| **2** | Port full /work-plan workflow to Overdeck CLI | Full planning pipeline shipped (vBRIEF, DAG, `pan plan`, planning agents) |
| **133** | Deacon idle/lazy detection false positives | Lazy detection code deleted in commit `239d2ca1b` |
| **250** | PLANNING_PROMPT.md contaminates work agent | `strip-planning-from-branch.ts` isolates planning artifacts (commit `f7f0375bf`) |
| **501** | Integrate smee.io for local GitHub webhook delivery | Integrated into `pan up`/`pan down`/`pan doctor`; `src/lib/smee.ts` exists |
| **536** | GitHub App integration for bot commit identity | `src/lib/github-app.ts` has PAN-536 header; core work done. #833 tracks remaining worktree bug |
| **650** | Deacon spams stuck agents forever | `STUCK_POKE_MAX = 3` + 15min cooldown at `deacon.ts:2862-2964` |
| **746** | Restore tests skipped for 0.7.0 release | Zero `it.skip`/`describe.skip`/`test.skip` remain in codebase |
| **808** | Merge refactor/issue-status-events | Shipped in commit `812cc2cff` |
| **846** | Reviewer and specialist tmux sessions leak | Merged via PR #851 (commit `a16dc4223`) |
| **850** | Merge flow: stuck on no-op rebase | Fixed in commit `a7e0329e1` — timeout raised, skip no-op rebase |
| **907** | Close-out doesn't live-update kanban board | Fix committed to main (commit `938392672`) |
| **909** | SyntaxError: ServiceMap export | Fixed by Effect bump to 4.0.0-beta.45 (commit `1f697f3a3`) |
| **911** | Conversations fail to attach in tmux | Fixed by stripping TMUX env (commit `16bde88b2`) |
| **922** | Dead code cleanup: DeferredTab | DeferredTab grep returns zero hits — already removed |

### Duplicates (10)

| # | Title | Duplicate of |
|---|-------|-------------|
| **365** | Light mode broken on Kanban | #146 (light mode umbrella) |
| **401** | Dashboard light mode broken | #146 |
| **553** | Plan modal: cut-off content, layout polish | #817 (planning dialog layout) |
| **579** | Ctrl+C in xterm kills Q&A prompt | #245 (Ctrl+C clipboard issue) |
| **602** | Add OpenCode as alternative runtime | #687 (same request, older) |
| **740** | Preserve new conversation draft navigating away | #548 (Command Deck state preservation) |
| **742** | Restore draft conversations on return | #548 |
| **766** | Add archived conversations view to Mission Control | #457 (archived conversations) |
| **820** | Add data-testid to interactive elements | #249 (data-testid + Playwright suite) |
| **843** | Stale reviewer tmux sessions persist | #846 (same bug, already fixed) |

### Superseded / Obsolete (10)

| # | Title | Reason |
|---|-------|--------|
| **40** | Add Models tab to dashboard | Settings page now has full model config (ProviderPanel, AgentCards, WorkTypeOverrides) |
| **103** | Progressive disclosure with resizable panels | Superseded by Command Deck layout; already tagged `wontfix` |
| **108** | Integrate Skills System + Activate Convoy | 60 skills synced; Convoy renamed to review pipeline and fully operational |
| **120** | Stitch MCP auth error | Stitch dependency has been dead since January; design work moved on |
| **121** | Redesign Settings Page with Stitch | Settings page already built; Stitch dependency dead. Tagged `wontfix` |
| **163** | PAN-TEST-1: Test regular work issue | Stale test scaffold from February; Mission Control redesigned |
| **164** | PAN-TEST-2: Test shadow/monitoring issue | Same — stale test scaffold |
| **798** | Eliminate all tmux capture-pane usage | Superseded by PAN-800 (PRD at `docs/prds/active/PAN-800`) |
| **799** | PAN-798 Research: open questions | Research companion to 798; moot after PAN-800 |
| **824** | Consolidate launcher.sh generation | Already merged (`7361131f9`); `src/lib/launcher-generator.ts` exists |

### Stale Research / No Traction (5)

| # | Title | Age | Why close |
|---|-------|-----|-----------|
| **52** | Guidance: multi-container projects with worktrees | 3 months | No traction, better as docs |
| **607** | Evaluate UBS for verification gate | 3 weeks | No references in codebase, no follow-through |
| **608** | Integrate DCG with configurable settings | 3 weeks | No references, no implementation |
| **749** | Research gstack best features | 2 weeks | No references, no action taken |
| **771** | Investigate Vercel Sandbox execution backend | 2 weeks | No references, pure research with no follow-through |

### Misplaced (2) — Move to MYN Linear

| # | Title | Reason |
|---|-------|--------|
| **268** | Create MYN project-specific Claude Code rules | MYN-specific; belongs in Linear as MIN-xxx |
| **707** | Add MCP tool to assign schedules to MYN chores | MYN product work, not Overdeck |

### Roll Into Other Issues (2)

| # | Title | Roll into |
|---|-------|----------|
| **307** | Adopt Superpowers prompt hardening | #591 (Karpathy LLM guidelines — same domain) |
| **327** | Incorporate structured verification + decision locking | #591 |

---

## Part 2: Consolidation Recommendations (32 issues → 8 parents)

These issues should be merged into parent tracking issues to reduce backlog noise.

### A. Provider Billing & Observability → #730

| Child # | Title |
|---------|-------|
| **570** | Show PLAN badge on costs under subscription |
| **571** | Add OpenRouter credits/plan status endpoint |
| **702** | OpenAI provider: plan/subscription support |
| **764** | Add quota/usage inspector for routed model providers |

### B. Metrics Page v2 → #750

| Child # | Title |
|---------|-------|
| **55** | Track specialist costs with time period filtering |
| **751** | Historical Metrics Data Persistence beyond 30-day window |
| **769** | Track verification/review/test phase churn over time |

### C. Documentation Overhaul → #634

| Child # | Title |
|---------|-------|
| **51** | Clarify issue tracker options beyond Linear |
| **589** | Review and update commands-skills.md |
| **633** | Update Cloister PRD and docs index |

### D. Cost Display Polish → new umbrella or #77

| Child # | Title |
|---------|-------|
| **765** | Preserve trailing zeros in cost displays |
| **797** | Cache write tokens not shown separately |

### E. Crash Recovery → #454

| Child # | Title |
|---------|-------|
| **456** | Store session IDs for resume after crash |
| **476** | Agent resume with Haiku summary |
| **483** | Unify Resume Agent UX |

### F. Model Overrides → #532

| Child # | Title |
|---------|-------|
| **322** | Per-issue model override (dashboard UI) |
| **735** | Settings: review/configure subagent model files |
| **736** | Wire per-subagent model overrides to spawn env |

### G. Light Mode → #146

| Child # | Title |
|---------|-------|
| **552** | Terminals should respect light/dark mode scheme |

### H. Deacon Reliability → #247

| Child # | Title |
|---------|-------|
| **675** | Detect API rate-limit events, auto-restart |

---

## Part 3: Priority Rankings (Remaining ~155 issues)

### Critical (5 issues) — 1.0 blockers or active pipeline corruption

| # | Title | Why critical |
|---|-------|-------------|
| **806** | Epic B: Work agent doesn't touch git | 1.0 architecture prerequisite |
| **807** | Epic C: Workspace state sanity on spawn | 1.0 architecture prerequisite |
| **804** | Epic D: Archaeological audit & pre-1.0 cleanup | 1.0 architecture prerequisite |
| **890** | Conflict-resolver merges stale snapshot, never pushes | Pipeline corruption — no conflict-resolver code found |
| **899** | Agent CLI commands fail: UNABLE_TO_VERIFY_LEAF_SIGNATURE | SSL cert bug blocking agent CLI commands |

### High (20 issues) — Bugs, perf, core functionality gaps

| # | Title | Category |
|---|-------|----------|
| **304** | closeLinearDirect returns stepOk on failure | Bug: confirmed silent failure in post-merge lifecycle |
| **334** | Dashboard server no duplicate-process protection | Bug: zombie instances cause 502 |
| **472** | GET /api/costs/by-issue takes 10s (N+1 query) | Perf: direct UX impact |
| **532** | Per-project/per-issue model overrides (umbrella) | Feature: core multi-agent capability |
| **546** | Remove claude-code-router | Cleanup: 3 files still reference it; needed for provider simplification |
| **548** | Command Deck: preserve state across navigation | UX: state loss on navigation |
| **605** | Reconcile CLAUDE.md prompt assembly across agent types | Arch: each agent assembles prompts independently |
| **666** | Verification gate blocks on pre-existing main failures | Pipeline: false-blocks on inherited failures |
| **673** | Virtualizer ref causes blank conversation page | Bug: blank page on large message lists |
| **681** | Feedback routing: wrong issueId for co-active issues | Bug: agent works on wrong problem |
| **704** | Rally Features missing action buttons in kanban | Feature: functional gap |
| **750** | Complete Metrics Page Redesign (umbrella) | Feature: current page is a skeleton |
| **774** | Unify launch UX and release pipeline for 1.0 | Arch: npx panctl, desktop builds |
| **780** | Agent stuck in feedback loop with old files | Bug: agent wastes tokens re-fixing resolved issues |
| **832** | state.json staleness: lastActivity/costSoFar | Bug: visible data incorrectness |
| **863** | Workspace + branch hygiene sweep | Ops: 150+ branches, 33 worktrees, growing |
| **875** | Backfill false-positive on verification-failed issues | Pipeline: state corruption |
| **886** | pan review shows 'fetch failed' hiding real error | Bug: error masking blocks diagnosis |
| **900** | Trust devroot + atomic .claude.json writes | Bug: active conversation/config issue |
| **920** | Inject subagent model env vars for non-Anthropic | Feature: blocks multi-provider usage |

### Medium (40+ issues) — Important but not urgent

**Pipeline & Agents:**
- #247 Deacon backoff for specialist failures (umbrella w/ #675)
- #262 Refactor post-merge lifecycle
- #306/#321 Merge-agent polyrepo failures (verify if fixed)
- #339 INPUT label not removed after agent kill
- #447 Migrate SQLite to Effect SQL layer
- #454 Crash recovery umbrella (#456, #476, #483)
- #471 Cost reconciler auto-trigger
- #487 VBRIEF not archived after merge
- #538 Build sometimes skips Vite rebuild
- #564 Slash menu positioned incorrectly
- #592 Audit planning agent CLAUDE.md contents
- #603 Plan review loop with configurable model
- #605 Reconcile prompt assembly
- #621 Cost data: cleanup TEST-1/TEST-2 + UNKNOWN
- #678 pan work issue --auto (headless planning)
- #727 Orphaned work-agent handoff after planning
- #778 Write conflict race: review vs test agent
- #813 Regression test for review reset
- #826 Conversation/terminal refactor
- #833 ENOTDIR for pan-credentials in worktrees
- #835 Workspace creation includes stale .planning/ in PR diff
- #838 synthesis.json hallucinated timestamps

**Dashboard & UX:**
- #20 Intercept AskUserQuestion in dashboard UI
- #44 Planning should fetch ALL issue context
- #146 Light mode umbrella (#552)
- #244 Deep-wipe leaves branch/worktree metadata
- #245 Ctrl+C aborts planning dialog (clipboard)
- #249 data-testid + Playwright smoke suite
- #283 Reset should sync with latest main
- #324 Agent detail pane missing Merge/Approve button
- #403 Plan button missing when derivedStatus in_progress
- #457 Archived Conversations page
- #654 Project Setup Wizard UI
- #656 Docs site CSS leaks onto overdeck.ai
- #660 Slash menu catalog drift (hardcoded array)
- #747 Conversation list lacks accessible labels
- #783 Agents Page Redesign
- #790 Eliminate remaining TanStack Query polling
- #817 Planning dialog layout and content
- #831 Refinish dashboard rebrand
- #864 Stash hygiene sweep
- #898 Dashboard polling/WebSocket efficiency audit

### Low (60+ issues) — Nice-to-have, future roadmap, post-1.0

**Alternative runtimes** (defer until providers mature):
#463 Qwen model support, #466 QwenCoder CLI, #636 Pi Coding Agent, #687 OpenCode, #853 terminal-bench

**Advanced workflow** (post-1.0):
#622 YAML workflow DAGs, #623 Multi-channel triggers, #624 Loop nodes, #629 Workspace quotas, #630 Multi-tenant ACLs, #658 Shared Sessions, #709 Self-improving flywheel

**Research & prompt engineering:**
#591 Karpathy guidelines (w/ #307, #327), #613 Thinking effort levels, #793 Deft lifecycle, #791 Deft skill mapping, #924 GitNexus spike

**Crash/resume family** (large, interdependent):
#175 Pre-compact auto-save, #178 Granular checkpointing, #293 Project Living Memory, #277 Session reasoning capture, #299 Session state persistence

**UI polish & nice-to-haves:**
#37/#38 Multiple merge agents + external PR, #43 Slack/email notifications, #47 PRD archival, #54 pan test:e2e, #77 Cost breakdown modal, #104/#106 Cost alerts/prediction, #111 Cross-machine sync, #113 Start Agent verification, #155 Health page redesign, #177 Iteration limits, #176 Delegation guardrails, #180 Cross-terminal file locking, #190 Specialized reviewer prompts, #198 Structured audit trail, #228 Shift-left diagnostics, #227 Phase gate validation, #241 Mobile redesign, #243 Audit CLI parity, #252 Disable Sync button, #255 MCP tool awareness, #265 Skill categorization, #271 Auto-assign Linear project, #294 Surface module init errors, #297 Workspace template hooks, #298 Auto-detect package manager, #399 Release specialist, #407 Run from main workspace, #452 Conversation input bar selectors, #459 Planning SSE progress, #461 Deep-wipe progress dialog, #465 OpenRouter provider, #468 Test isolation, #531 Windows Electron, #537 Changed files diff in activity, #543 Optimal Defaults confirmation, #541 Filesystem→SQLite migration, #565 Ctrl+Z undo archival, #568 Kanban stats, #576 Global search includes conversations, #578 Comment mediation (security), #604 Hide planning agent, #649 Excalidraw inline, #646 Canceled issue recovery, #637 Direct kickoff, #674 Glossary, #683 Test env-dependency, #700 Detachable terminal, #701 Quick-create conversation, #713 done/approve tests, #738 Right-click fork, #748 Context usage indicator, #752 Gemini OAuth + model cleanup, #773 Prompt-style overlays, #775 Workspace inspector redesign, #777 Inter-agent communication, #786 Post planning Q&A as comment, #802 Resume on forks, #810 Inspector unknown phase, #818 Optional fork summary, #829 TTS settings, #834 Legacy heartbeats cleanup, #901 Settings maintenance panel, #902 Settings pan sync button, #903 Detect .claude.json corruption, #904 AI title model configurable, #908 Configurable spawn limits

---

## Part 4: Thematic Summary

### What's actually working well (no action needed)
- Review pipeline (event-driven, multi-pass iterative deepening)
- Skills system (60 skills synced)
- Deacon stuck-agent handling (max pokes + cooldown implemented)
- Planning artifact isolation (strip-planning-from-branch)
- GitHub App credential support (core shipped)
- smee.io webhook delivery
- Effect.js adoption (58 files, growing)

### Biggest backlog themes
1. **1.0 readiness** — Epics B/C/D (#806, #807, #804) plus launch UX (#774) are the critical path
2. **Dashboard state & UX** — Command Deck landed but state preservation (#548), data freshness (#832), and light mode (#146) need attention
3. **Pipeline correctness** — Several confirmed bugs in feedback routing (#681), verification gates (#666, #875), and post-merge lifecycle (#304)
4. **Model/provider expansion** — Provider billing (#730 umbrella), model overrides (#532 umbrella), and router removal (#546) are the active work
5. **Operational hygiene** — 150+ branches (#863), stale stashes (#864), and legacy filesystem state need cleanup

### Key ratios
- **43 of 232 issues (19%)** can be closed right now
- **32 issues** should be consolidated into 8 parent issues
- **5 issues** are critical (1.0 blockers + active pipeline corruption)
- **~60 issues** are low-priority / post-1.0 / nice-to-have
