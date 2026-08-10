/* Live snapshot captured 2026-08-01T15:52Z from this machine's Overdeck instance.
   Consumed by god-view-river.html — overrides the embedded FALLBACK. */
window.GODVIEW_SNAPSHOT = {
  capturedAt: '2026-08-01T15:52:21.080Z',
  system: { cpuPct: 93, memPct: 81, memUsedGB: 50.2, memTotalGB: 62.0, loadAvg: '45.4' },
  totals: { active: 26, total: 245 },
  roleCounts: { plan: 7, work: 7, review: 3, test: 2, flywheel: 1, sequencer: 1, strike: 5 },
  staleTotal: 111,
  issues: [
    /* ── PLAN column — 7 planning agents (k3) ── */
    { id: 'MIN-923',  project: 'myn',      stage: 'PLAN', role: 'plan', heat: .92, model: 'k3[1m]', harness: 'claude-code', title: 'Kaia prompt modernization v5 — cut static Block 1 from ~101KB to ~26KB' },
    { id: 'MIN-924',  project: 'myn',      stage: 'PLAN', role: 'plan', heat: .88, model: 'k3[1m]', harness: 'claude-code', title: 'Add updateCalendarEvent / deleteCalendarEvent AI tools for external calendar events' },
    { id: 'PAN-3410', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .8,  model: 'k3[1m]', harness: 'claude-code', title: 'style guide v2 — Geist type system, display scale, chips, soft cards', labels: ['planning','planned'] },
    { id: 'PAN-3411', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .76, model: 'k3[1m]', harness: 'claude-code', title: 'New Workspace as a full-page creation experience (replaces the modal)', labels: ['planning','planned'] },
    { id: 'PAN-3423', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .7,  model: 'k3[1m]', harness: 'claude-code', title: 'Redesign SystemHealthPill popover: attention-grouped reasons, metered vitals', labels: ['enhancement','planning','planned'] },
    { id: 'PAN-3396', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .66, model: 'k3[1m]', harness: 'claude-code', title: 'bug(membership): zombie_pr bucket resurrects closed-out issues as inPipeline', labels: ['bug','planning','planned','substrate-improvement'] },
    { id: 'PAN-3338', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .58, model: 'k3[1m]', harness: 'claude-code', title: "Finished plan agent reads as 'still planning' once its idle signal is cleared", labels: ['bug','planning','planned'] },

    /* ── WORK column — work agents + 3 live strikes ── */
    { id: 'PAN-3419', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .95, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'pan handoff has no --project: isolated --cwd lands successors outside all registered projects', labels: ['bug','in-progress'] },
    { id: 'PAN-3418', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .9,  model: 'gpt-5.6-sol', harness: 'claude-code', title: 'Empty-string conversation model is stored, never backfilled, blanks harness+model chips', labels: ['bug','in-progress'] },
    { id: 'PAN-3422', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .93, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'bug(delivery): nudge/feedback text lands in agent composer but is never submitted', labels: ['bug','substrate-improvement'] },
    { id: 'PAN-3420', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .85, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'Dashboard + pan show render a completed, closed-out issue as never-started', labels: ['planned'] },
    { id: 'PAN-3416', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .8,  model: 'gpt-5.6-sol', harness: 'claude-code', title: 'bug(dashboard): MYN issue-tree crew omits live review sessions', labels: ['bug'] },
    { id: 'PAN-1577', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .68, model: 'claude-sonnet-5', harness: 'claude-code', title: 'Move a conversation to a different project (CLI + drag/drop + menu action)' },
    { id: 'MIN-930',  project: 'myn',      stage: 'WORK', role: 'work',   heat: .34, model: null, harness: null, title: '[P0 Security] GET /api/v1/customers leaks Google OAuth access + refresh tokens to any AGENT_FULL API key' },
    { id: 'MIN-931',  project: 'myn',      stage: 'WORK', role: 'work',   heat: .3,  model: null, harness: null, title: 'Hermes MYN plugin is not agent-safe: dead tool schemas, no read-before-write guard, broken memory recall, unbounded YNAB reads' },

    /* ── REVIEW column — convoys live right now ── */
    { id: 'MIN-839', project: 'myn', stage: 'REVIEW', role: 'review', heat: .98, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'Fizzy Integration Phase 3: Fizzy → MYN sync + @Kaia on cards',
      convoy: ['security','correctness','performance','requirements','synthesis'] },
    { id: 'MIN-874', project: 'myn', stage: 'REVIEW', role: 'review', heat: .86, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'Bring Your Own AI: user-supplied OpenAI API key or ChatGPT subscription (OAuth) for Kaia and Compass',
      convoy: ['synthesis'] },
    { id: 'MIN-864', project: 'myn', stage: 'REVIEW', role: 'review', heat: .8, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'Voice: navigate_to_screen function tool — Kaia can take you to different screens',
      convoy: ['synthesis'] },

    /* ── TEST column ── */
    { id: 'PAN-3367', project: 'overdeck', stage: 'TEST', role: 'test', heat: .88, model: 'claude-sonnet-5', harness: 'claude-code', title: 'Audit: code-level review of 29 issues whose negative verdict was reset to a pass', labels: ['in-review'] },
    { id: 'PAN-3362', project: 'overdeck', stage: 'TEST', role: 'test', heat: .5,  model: 'claude-sonnet-5', harness: 'claude-code', title: 'No way to seed tracker-backed issue fixtures in workspace containers', labels: ['in-review'], warn: 'stack exited 0' },

    /* ── VERIFY column — merged, close-out pending, strikes still on them ── */
    { id: 'PAN-3413', project: 'overdeck', stage: 'VERIFY', role: 'ship', heat: .62, model: 'gpt-5.6-sol', harness: 'claude-code', title: 'fix(state): record reconcile rejects orphaned canonical drafts, blocks pan done', labels: ['bug','needs-close-out','merged'] },
    { id: 'PAN-3407', project: 'overdeck', stage: 'VERIFY', role: 'ship', heat: .5,  model: 'gpt-5.6-sol', harness: 'claude-code', title: 'bug(dashboard): cockpit Terminal toggle does nothing while tmux session is alive', labels: ['bug','needs-close-out','merged'] },

    /* ── DOLDRUMS — 8 emissaries of the 111 frozen ── */
    { id: 'PAN-1204', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'Home tab + live session-context briefing with advisory compliance audit hook', staleMin: 593 },
    { id: 'PAN-1370', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'Editor & file-navigation integration: wire up Open picker, port MarkdownFileLink chip menu, add file Quickview, expand editor registry', staleMin: 1825 },
    { id: 'PAN-1107', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'Ship role cost $4.95 for a single sync-main merge on PAN-457 — investigate cost spike', staleMin: 4039 },
    { id: 'MIN-892',  project: 'myn',      stage: 'WORK', role: 'work', heat: .1, title: 'Redesign: unify Kaia voice + conversation into one timeline with sessions', staleMin: 12281 },
    { id: 'PAN-2927', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'Red main remainder: cherry-pick parseProcessTable fix + shrink dashboard-types baseline to 66 + update state-plane-docs allowlist for xBRIEF rename', staleMin: 18783 },
    { id: 'PAN-2762', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'Red main: release.ts calls dirname without importing it — typecheck fails (1 error), blocking all strikes and the release command', staleMin: 23851 },
    { id: 'MIN-206',  project: 'myn',      stage: 'WORK', role: 'work', heat: .1, title: 'Upgrade to Spring AI 1.1.0-RC1 with Anthropic Caching & ChatMemory', staleMin: 34551 },
    { id: 'PAN-2692', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, title: 'State-worktree auto-commits die with short-lived pan CLI processes — dirty worktree then blocks all pipeline starts', staleMin: 24570 },
  ],
  paused: [
    { id: 'MIN-864', project: 'myn', role: 'work', title: 'Voice: navigate_to_screen function tool — Kaia can take you to different screens', model: 'gpt-5.6-sol', harness: 'claude-code', yieldReason: 'yield: making room for review of MIN-874', idleMin: 28 },
  ],
  failed: [
    { id: 'PAN-2869', project: 'overdeck' },
    { id: 'PAN-2833', project: 'overdeck' },
    { id: 'PAN-3122', project: 'overdeck' },
  ],
  backlog: ['PAN-3425', 'MIN-932', 'PAN-3430', 'MIN-935', 'PAN-3434', 'MIN-938'],
  conversations: { active: 19 },
  sequencer: true,
  eventsPerMinute: 100,
  mergesToday: 4,
  tokensToday: 38400000,
  seedFeed: [
    { kind: 'review', id: 'MIN-839', msg: 'convoy spawned — security/correctness/performance/requirements + synthesis' },
    { kind: 'yield',  id: 'MIN-864', msg: 'yielded by scheduler — making room for review of MIN-874' },
    { kind: 'review', id: 'MIN-923', msg: 'review.status_changed' },
    { kind: 'hook',   id: 'PAN-3419', msg: 'PostToolUse · Bash — vitest 214 passed' },
    { kind: 'strike', id: 'PAN-3422', msg: 'Edit — delivery submit guard' },
    { kind: 'test',   id: 'PAN-3362', msg: 'stack unhealthy: server-1 exited (0)' },
  ],
};
