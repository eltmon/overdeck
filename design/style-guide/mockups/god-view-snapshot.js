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
    { id: 'MIN-923',  project: 'myn',      stage: 'PLAN', role: 'plan', heat: .92, title: 'planning' },
    { id: 'MIN-924',  project: 'myn',      stage: 'PLAN', role: 'plan', heat: .88, title: 'planning' },
    { id: 'PAN-3410', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .8,  title: 'style guide v2' },
    { id: 'PAN-3411', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .76, title: 'new-workspace page' },
    { id: 'PAN-3423', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .7,  title: 'SystemHealthPill popover' },
    { id: 'PAN-3396', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .66, title: 'zombie_pr membership' },
    { id: 'PAN-3338', project: 'overdeck', stage: 'PLAN', role: 'plan', heat: .58, title: 'plan-state bug' },

    /* ── WORK column — work agents + 3 live strikes ── */
    { id: 'PAN-3419', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .95, title: 'handoff --project' },
    { id: 'PAN-3418', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .9,  title: 'empty model blanks chips' },
    { id: 'PAN-3422', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .93, title: 'delivery submit wedge' },
    { id: 'PAN-3420', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .85, title: 'closed-out renders new' },
    { id: 'PAN-3416', project: 'overdeck', stage: 'WORK', role: 'strike', heat: .8,  title: 'issue-tree omits reviews' },
    { id: 'PAN-1577', project: 'overdeck', stage: 'WORK', role: 'work',   heat: .68, title: 'legacy work' },
    { id: 'MIN-930',  project: 'myn',      stage: 'WORK', role: 'work',   heat: .34, title: '', staleMin: 0 },
    { id: 'MIN-931',  project: 'myn',      stage: 'WORK', role: 'work',   heat: .3,  title: '', staleMin: 0 },

    /* ── REVIEW column — convoys live right now ── */
    { id: 'MIN-839', project: 'myn', stage: 'REVIEW', role: 'review', heat: .98, title: 'full convoy',
      convoy: ['security','correctness','performance','requirements','synthesis'] },
    { id: 'MIN-874', project: 'myn', stage: 'REVIEW', role: 'review', heat: .86, title: 'synthesis review',
      convoy: ['synthesis'] },
    { id: 'MIN-864', project: 'myn', stage: 'REVIEW', role: 'review', heat: .8, title: 'synthesis review',
      convoy: ['synthesis'] },

    /* ── TEST column ── */
    { id: 'PAN-3367', project: 'overdeck', stage: 'TEST', role: 'test', heat: .88, title: 'audit of 29 resets' },
    { id: 'PAN-3362', project: 'overdeck', stage: 'TEST', role: 'test', heat: .5,  title: 'tracker fixtures', warn: 'stack exited 0' },

    /* ── VERIFY column — merged, close-out pending, strikes still on them ── */
    { id: 'PAN-3413', project: 'overdeck', stage: 'VERIFY', role: 'ship', heat: .62, title: 'record reconcile fix' },
    { id: 'PAN-3407', project: 'overdeck', stage: 'VERIFY', role: 'ship', heat: .5,  title: 'terminal toggle' },

    /* ── DOLDRUMS — 8 emissaries of the 111 frozen ── */
    { id: 'PAN-1204', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 593 },
    { id: 'PAN-1370', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 1825 },
    { id: 'PAN-1107', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 4039 },
    { id: 'MIN-892',  project: 'myn',      stage: 'WORK', role: 'work', heat: .1, staleMin: 12281 },
    { id: 'PAN-2927', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 18783 },
    { id: 'PAN-2762', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 23851 },
    { id: 'MIN-206',  project: 'myn',      stage: 'WORK', role: 'work', heat: .1, staleMin: 34551 },
    { id: 'PAN-2692', project: 'overdeck', stage: 'WORK', role: 'work', heat: .1, staleMin: 24570 },
  ],
  paused: [
    { id: 'MIN-864', project: 'myn', role: 'work', yieldReason: 'yield: making room for review of MIN-874', idleMin: 28 },
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
