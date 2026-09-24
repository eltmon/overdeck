/**
 * PAN-3849 (W37): shared fixture world for the liveness no-loss audit.
 *
 * This module is deliberately tree-agnostic: it runs unchanged against the
 * pre-Phase-4 tree (fixture capture) and the post-Phase-4 tree (comparison),
 * so every import here must exist in BOTH trees at the same path. The tmux /
 * process-table boundaries are mocked by the test file; this module seeds the
 * durable state (agents rows, runtime mirrors, session pointers, transcripts,
 * review_status rows) and runs the four consumers the PRD names.
 *
 * The fixture world is built so the old predicates and the new oracle AGREE:
 * every "live" agent has a session AND a live pane AND the harness process in
 * the pane subtree; every other agent has no session at all. The no-loss
 * claim is: on every state where the definitions agree, consumer output is
 * identical. Where they disagree (the remain-on-exit zombie), the behavior
 * change is the intended F12 fix, covered by the oracle's own tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';

import { saveAgentRuntimeState, saveAgentStateSync, saveSessionId } from '../../../../src/lib/agents.js';
import { encodeClaudeProjectDir } from '../../../../src/lib/runtimes/storage/claude-code.js';
import { setReviewStatusSync } from '../../../../src/lib/review-status.js';
import type { OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

export const FIXED_NOW_ISO = '2026-09-17T12:00:00.000Z';
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

export const AGENTS = {
  /** running + genuinely alive (session, live pane, runtime in subtree) */
  alive: 'agent-pan-9001',
  /** stopped, no session, workspace present, resumable transcript */
  stopped: 'agent-pan-9002',
  /** starting, no session yet, workspace present */
  starting: 'agent-pan-9003',
  /** stopped, no session, workspace missing */
  orphanish: 'agent-pan-9004',
  /** running + genuinely alive, but its issue is already merged (zombie-session orbit) */
  zombieOnMerged: 'agent-pan-9005',
} as const;

export const ISSUES = {
  alive: 'PAN-9001',
  stopped: 'PAN-9002',
  starting: 'PAN-9003',
  orphanish: 'PAN-9004',
  zombieOnMerged: 'PAN-9005',
} as const;

/** The mocked tmux/process world (consumed by the test file's vi.mock factories). */
export const TMUX_WORLD = {
  sessions: [AGENTS.alive, AGENTS.zombieOnMerged],
  /** '<pid>\t<dead>' rows per session, as listPaneValues returns them. */
  panes: { [AGENTS.alive]: ['4242\t0'], [AGENTS.zombieOnMerged]: ['4243\t0'] } as Record<string, string[]>,
  /** runtime pid found in the pane subtree per agent, null = runtime-missing. */
  runtimePids: { [AGENTS.alive]: 4242, [AGENTS.zombieOnMerged]: 4243 } as Record<string, number | null>,
};

function writeTranscript(home: string, workspace: string, sessionId: string): void {
  const projectDir = join(home, '.claude', 'projects', encodeClaudeProjectDir(workspace));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{"type":"summary"}\n', 'utf8');
}

/** Seed every holder the four consumers read. Idempotent within one OverdeckTestDb. */
export function seedAuditWorld(odb: OverdeckTestDb): { workspaces: Record<string, string> } {
  const home = odb.home;
  const workspaces: Record<string, string> = {};
  for (const [key, agentId] of Object.entries(AGENTS)) {
    const issueId = ISSUES[key as keyof typeof ISSUES];
    const workspace = join(home, 'workspaces', `feature-${issueId.toLowerCase()}`);
    workspaces[agentId] = workspace;

    const shared = {
      id: agentId,
      issueId,
      workspace,
      harness: 'claude-code' as const,
      role: 'work' as const,
      model: 'claude-sonnet-4-6',
      startedAt: '2026-09-17T08:00:00.000Z',
    };

    if (key === 'orphanish') {
      // Workspace deliberately NOT created on disk.
      saveAgentStateSync({
        ...shared,
        status: 'stopped',
        lastActivity: '2026-09-17T09:30:00.000Z',
        stoppedAt: '2026-09-17T09:30:00.000Z',
      });
      setReviewStatusSync(issueId, { reviewStatus: 'blocked', testStatus: 'pending', uatStatus: 'failed' });
      continue;
    }

    if (key === 'zombieOnMerged') {
      const workspace2 = join(home, 'workspaces', `feature-${issueId.toLowerCase()}`);
      mkdirSync(workspace2, { recursive: true });
      saveAgentStateSync({
        ...shared,
        status: 'running',
        lastActivity: '2026-09-17T11:50:00.000Z',
      });
      saveAgentRuntimeState(agentId, { state: 'active', lastActivity: '2026-09-17T11:50:00.000Z' });
      setReviewStatusSync(issueId, { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged' });
      continue;
    }

    mkdirSync(workspace, { recursive: true });

    if (key === 'alive') {
      saveAgentStateSync({
        ...shared,
        status: 'running',
        lastActivity: '2026-09-17T11:55:00.000Z',
      });
      saveAgentRuntimeState(agentId, { state: 'active', lastActivity: '2026-09-17T11:55:00.000Z' });
      saveSessionId(agentId, 'sess-9001');
      writeTranscript(home, workspace, 'sess-9001');
      setReviewStatusSync(issueId, { reviewStatus: 'blocked', testStatus: 'pending' });
      continue;
    }

    if (key === 'stopped') {
      saveAgentStateSync({
        ...shared,
        status: 'stopped',
        lastActivity: '2026-09-17T09:00:00.000Z',
        stoppedAt: '2026-09-17T09:05:00.000Z',
      });
      saveAgentRuntimeState(agentId, { state: 'stopped', lastActivity: '2026-09-17T09:00:00.000Z' });
      saveSessionId(agentId, 'sess-9002');
      writeTranscript(home, workspace, 'sess-9002');
      setReviewStatusSync(issueId, { reviewStatus: 'passed', testStatus: 'passed', mergeStatus: 'merged' });
      continue;
    }

    // starting: real child-written 'starting' state, no tmux session yet.
    saveAgentStateSync({
      ...shared,
      status: 'starting',
      lastActivity: '2026-09-17T11:59:00.000Z',
    });
  }

  // Normalize volatile DB columns so capture and comparison are byte-identical.
  const db = odb.raw();
  db.prepare(`UPDATE agents SET updated_at = ?`).run(1_700_000_000_000);
  db.prepare(`UPDATE review_status SET updated_at = ?`).run(FIXED_NOW_ISO);

  return { workspaces };
}

/** Recursively strip volatile keys that legitimately differ between runs. */
export function normalizeForAudit(value: unknown, volatileHome?: string): unknown {
  if (typeof value === 'string' && volatileHome && value.includes(volatileHome)) {
    return value.split(volatileHome).join('<AUDIT_HOME>');
  }
  if (Array.isArray(value)) return value.map((child) => normalizeForAudit(child, volatileHome));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue; // JSON.stringify drops these; compare structurally
      if (key === 'updatedAt') continue; // write-time stamp, not liveness surface
      // Retired in W34 — the placeholder concept no longer exists, so the
      // lifecycle output no longer carries this field. Its removal IS the
      // work item (deliberate, enumerated here), not an accidental loss the
      // audit exists to catch.
      if (key === 'isPlaceholder') continue;
      out[key] = normalizeForAudit(child, volatileHome);
    }
    return out;
  }
  return value;
}

export async function runLifecycleConsumer(): Promise<unknown> {
  const { getWorkAgentLifecycleStateSync } = await import('../../../../src/lib/work-agent-lifecycle.js');
  const out: Record<string, unknown> = {};
  for (const agentId of Object.values(AGENTS)) {
    out[agentId] = getWorkAgentLifecycleStateSync(agentId);
  }
  return out;
}

export async function runParkedConsumer(): Promise<unknown> {
  const { resolveParkedPopulation } = await import('../../../../src/lib/parked/resolver.js');
  return resolveParkedPopulation({
    now: FIXED_NOW_MS,
    isClosed: async () => false,
    readRecordTerminal: async () => false,
    readOpenTrips: async () => [],
  });
}

export async function runStatusConsumer(): Promise<unknown> {
  const { statusCommand } = await import('../../../../src/cli/commands/status.js');
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await statusCommand({ json: true });
  } finally {
    console.log = original;
  }
  return JSON.parse(lines.join('\n')) as unknown;
}

function dodStubRow(id: string, num: number, title: string) {
  return { id, num, title, expected: 'stubbed external row (audit fixture)', observed: 'stubbed by the no-loss audit', status: 'pass' as const };
}

/**
 * The DoD gate's deps replace the whole row set (the real row functions are
 * module-private, so they cannot be kept while stubbing git/tracker/docker).
 * These stubs read the REAL review_status door the fixtures seed, so the
 * audit still exercises that holder; everything else about the rows is fixed.
 */
async function dodStatusRow(issueId: string, id: string, num: number, title: string, field: 'reviewStatus' | 'testStatus' | 'verificationStatus') {
  const { getReviewStatusSync } = await import('../../../../src/lib/review-status.js');
  const row = getReviewStatusSync(issueId);
  const value = row?.[field] ?? 'pending';
  return {
    id,
    num,
    title,
    expected: 'review_status row (fixture-seeded)',
    observed: `${field}=${value}`,
    status: (value === 'failed' || value === 'blocked' ? 'miss' : 'pass') as 'miss' | 'pass',
  };
}

export async function runDodGateConsumer(): Promise<unknown> {
  const { evaluateDodGate } = await import('../../../../src/lib/lifecycle/dod-gate.js');
  const out: Record<string, unknown> = {};
  for (const issueId of [ISSUES.alive, ISSUES.stopped]) {
    const result = await evaluateDodGate(
      { issueId, projectPath: '/nonexistent-audit-project' },
      {},
      {
        review: (id) => dodStatusRow(id, 'review', 1, 'Review', 'reviewStatus'),
        tests: (id) => dodStatusRow(id, 'tests', 2, 'Tests', 'testStatus'),
        verification: (id) => dodStatusRow(id, 'verification', 3, 'Verification', 'verificationStatus'),
        // Externals stubbed to fixed values.
        merged: async () => dodStubRow('merged', 4, 'Merged'),
        postMerge: async () => dodStubRow('postMerge', 5, 'Post-merge lifecycle'),
        mainVerify: async () => dodStubRow('mainVerify', 6, 'Verify on main'),
        ship: async () => dodStubRow('ship', 7, 'Ship'),
        deploy: async () => dodStubRow('deploy', 8, 'Deploy'),
        trackerClosed: async () => false,
        reconcileContainedStrike: async () => {},
        now: () => FIXED_NOW_ISO,
      },
    );
    out[issueId] = result;
  }
  return out;
}

export async function runAllConsumers(volatileHome?: string): Promise<Record<string, unknown>> {
  return normalizeForAudit({
    lifecycle: await runLifecycleConsumer(),
    parked: await runParkedConsumer(),
    status: await runStatusConsumer(),
    dodGate: await runDodGateConsumer(),
  }, volatileHome) as Record<string, unknown>;
}

/** For Effect-based mock factories in the test file. */
export function effectOf<T>(value: T) {
  return Effect.succeed(value);
}
