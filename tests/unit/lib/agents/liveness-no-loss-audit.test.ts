/**
 * PAN-3849 (W37): no-loss audit for the Phase 4 liveness rewiring (NFR-4).
 *
 * Runs the four consumers the PRD names — pan status, pan parked, the DoD
 * gate (evaluateDodGate), and getWorkAgentLifecycleStateSync — over a fixture
 * world where the old predicates and the new oracle agree, and asserts their
 * output is byte-identical to the fixtures captured on the pre-Phase-4 tree.
 *
 * Regenerate the "before" fixtures on the pre-Phase-4 tree with:
 *   LIVENESS_AUDIT_CAPTURE=1 LIVENESS_AUDIT_FIXTURE_DIR=<abs path to tests/fixtures/liveness-before> \
 *     npx vitest run tests/unit/lib/agents/liveness-no-loss-audit.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';
import {
  AGENTS,
  TMUX_WORLD,
  runAllConsumers,
  seedAuditWorld,
} from './liveness-audit-world.js';

// ─── Boundary mocks (the machine, not the logic) ────────────────────────────
// Everything the four consumers could read from the host: tmux, the process
// table, the census snapshot, Docker, shadow state, and the dashboard URL.
// The liveness logic itself runs for real.

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/tmux.js')>();
  const exists = (name: string) => TMUX_WORLD.sessions.includes(name);
  const panes = (target: string) => TMUX_WORLD.panes[target] ?? [];
  return {
    ...actual,
    sessionExistsSync: (name: string) => exists(name),
    sessionExists: (name: string) => Effect.succeed(exists(name)),
    querySessionSync: (name: string) => (exists(name)
      ? { status: 'exists' as const }
      : { status: 'missing' as const, detail: 'audit fixture: no such session' }),
    listPaneValuesSync: (target: string) => panes(target),
    listPaneValues: (target: string) => Effect.succeed(panes(target)),
    listSessionNamesSync: () => [...TMUX_WORLD.sessions],
    listSessionNames: () => Effect.succeed([...TMUX_WORLD.sessions]),
    listSessionsSync: () => TMUX_WORLD.sessions.map((name) => ({ name })),
  };
});

vi.mock('../../../../src/lib/agents/runtime-pid-probe.js', () => ({
  findAgentRuntimePidInSubtree: async (rootPid: string) => {
    for (const [agentId, panes] of Object.entries(TMUX_WORLD.panes)) {
      if (panes.some((row) => row.split('\t')[0] === rootPid)) return TMUX_WORLD.runtimePids[agentId] ?? null;
    }
    return null;
  },
  findAgentRuntimePidInSubtreeSync: (rootPid: string) => {
    for (const [agentId, panes] of Object.entries(TMUX_WORLD.panes)) {
      if (panes.some((row) => row.split('\t')[0] === rootPid)) return TMUX_WORLD.runtimePids[agentId] ?? null;
    }
    return null;
  },
}));

vi.mock('../../../../src/lib/runtime-census.js', () => ({
  getRuntimeCensusSnapshot: () => null,
}));

vi.mock('../../../../src/lib/workspace/stack-health.js', () => ({
  collectDockerContainerLifecycleSnapshot: () => Effect.succeed([]),
  getWorkspaceStackHealth: () => Effect.succeed(null),
  inferIssueIdFromStackContainerName: () => null,
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  isShadowed: () => Effect.succeed(false),
  getShadowState: () => Effect.succeed(null),
}));

vi.mock('../../../../src/lib/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/config.js')>();
  return {
    ...actual,
    // Unreachable on purpose: pan status's no-resume probe must fail closed,
    // identically on every run and every machine (a live dashboard on 3011
    // would otherwise make the fixture machine-dependent).
    getDashboardApiUrlSync: () => 'http://127.0.0.1:9',
  };
});

// ─── The audit ──────────────────────────────────────────────────────────────

const CAPTURE = process.env.LIVENESS_AUDIT_CAPTURE === '1';
const FIXTURE_DIR = process.env.LIVENESS_AUDIT_FIXTURE_DIR
  ?? new URL('../../../fixtures/liveness-before', import.meta.url).pathname;

let odb: OverdeckTestDb;
let savedHome: string | undefined;
let savedNoResume: string | undefined;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  savedHome = process.env.HOME;
  process.env.HOME = odb.home; // ~/.claude resolves inside the fixture world
  // Same reason as the getDashboardApiUrlSync mock above: pan status's
  // no-resume probe short-circuits on OVERDECK_NO_RESUME before it ever
  // reaches the (deliberately unreachable) dashboard URL. The verification
  // gate inherits that variable from a dashboard booted with --no-resume, so
  // leaving it set makes every agent row carry gatingReason "Boot
  // --no-resume" and the fixture comparison machine-dependent.
  savedNoResume = process.env.OVERDECK_NO_RESUME;
  delete process.env.OVERDECK_NO_RESUME;
  seedAuditWorld(odb);
}, 30_000);

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedNoResume === undefined) delete process.env.OVERDECK_NO_RESUME;
  else process.env.OVERDECK_NO_RESUME = savedNoResume;
  teardownOverdeckTestDb(odb);
});

/**
 * The twelve liveness state holders (pipeline-reliability-review, Section 6)
 * and the source each consumer-read field resolves to after Phase 4. The
 * audit's fixture outputs exercise every field named here.
 */
const TWELVE_HOLDERS = [
  { holder: 'agents/<id>/state.json', fields: ['status', 'stoppedAt', 'startedAt', 'lastActivity'], sourceAfter: 'the child writes real state; the W33 projection writes it from supervisor lifecycle events; no placeholder writer remains' },
  { holder: 'SQLite agents table (overdeck.db)', fields: ['status', 'lastActivity'], sourceAfter: 'saveAgentStateAndEmitEventWithDeps (one transaction), or saveOverdeckAgentStateSync from the child' },
  { holder: 'tmux session (-L overdeck)', fields: ['liveness'], sourceAfter: 'src/lib/agents/liveness.ts isAlive/isAliveSync (session + live pane + harness in subtree)' },
  { holder: 'event store events projection', fields: ['agent.started'], sourceAfter: 'emitted by the W33 lifecycle route on session-started, never from a pre-spawn placeholder' },
  { holder: 'lifecycle.log bracket lines', fields: [], sourceAfter: 'unchanged (persistent-logger.ts)' },
  { holder: 'lifecycle.log JSON lines', fields: [], sourceAfter: 'unchanged (composer-commands/detached.ts)' },
  { holder: 'runtime.json mirror', fields: ['runtimeState', 'lastActivity'], sourceAfter: 'unchanged (hook-driven); the mirror idle label alone never means idle (FR-5, liveness.ts isIdle)' },
  { holder: 'agent-plane record on the state branch', fields: ['sessions'], sourceAfter: 'unchanged (recordAgentPlaneSpawn / appendAgentPlaneSession)' },
  { holder: 'completed / completed.processed markers', fields: ['handedOff'], sourceAfter: 'unchanged (done.ts)' },
  { holder: 'per-issue record harness/model mirror', fields: ['harness', 'model'], sourceAfter: 'child-written real state only — the placeholder mirror branch is deleted (records.ts)' },
  { holder: 'session pointers (session.id, sessions.json)', fields: ['sessionId'], sourceAfter: 'unchanged (session-history.ts); never adopted from a transcript directory listing (W35)' },
  { holder: 'health.json / monitor.json / ready.json / cv.json sidecars', fields: [], sourceAfter: 'unchanged' },
] as const;

describe('liveness no-loss audit (PAN-3849 W37)', () => {
  it('enumerates the twelve holders and their post-Phase-4 sources', () => {
    // The table is the audit manifest: every holder from the review's
    // Section 6 is present, and each names its new source. The fixture
    // outputs below prove the consumer-read fields still resolve.
    expect(TWELVE_HOLDERS).toHaveLength(12);
    for (const entry of TWELVE_HOLDERS) {
      expect(entry.sourceAfter.length).toBeGreaterThan(0);
    }
    // Every consumer-read field the PRD names is covered by some holder.
    const coveredFields = new Set(TWELVE_HOLDERS.flatMap((h) => h.fields as readonly string[]));
    for (const field of ['status', 'lastActivity', 'sessionId', 'stoppedAt', 'startedAt']) {
      expect(coveredFields.has(field)).toBe(true);
    }
  });

  it('produces consumer outputs identical to the pre-Phase-4 fixtures', async () => {
    const outputs = await runAllConsumers(odb.home);

    if (CAPTURE) {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(join(FIXTURE_DIR, 'consumer-outputs.json'), `${JSON.stringify(outputs, null, 2)}\n`, 'utf8');
      console.log(`[liveness-audit] captured consumer outputs to ${FIXTURE_DIR}/consumer-outputs.json`);
      return;
    }

    const fixturePath = join(FIXTURE_DIR, 'consumer-outputs.json');
    expect(
      existsSync(fixturePath),
      `no-loss fixtures missing at ${fixturePath} — capture them on the pre-Phase-4 tree (see header)`,
    ).toBe(true);
    const before = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;

    // AC-W37: the fixture diff is empty. Both sides are normalized the same
    // way (volatile write-time stamps; the deliberately retired isPlaceholder
    // field — see liveness-audit-world.ts).
    const { normalizeForAudit } = await import('./liveness-audit-world.js');
    expect(outputs).toEqual(normalizeForAudit(before, odb.home));

    // Field-level readability check: the named fields actually resolved
    // (an all-null comparison would pass vacuously).
    const lifecycle = outputs['lifecycle'] as Record<string, Record<string, unknown>>;
    const alive = lifecycle[AGENTS.alive]!;
    expect(alive['agentStatus']).toBe('running');
    expect(alive['hasLiveTmuxSession']).toBe(true);
    const stopped = lifecycle[AGENTS.stopped]!;
    expect(stopped['agentStatus']).toBe('stopped');
    expect(stopped['hasSavedSession']).toBe(true);
  }, 60_000);
});
