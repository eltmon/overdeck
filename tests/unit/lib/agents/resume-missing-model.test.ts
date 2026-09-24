/**
 * PAN-3859 W7 — no-loss audit for the resume.ts hardcoded model fallback.
 *
 * Before this change, resuming an agent whose state file had no model silently
 * ran 'claude-sonnet-4-6' — a model nobody chose. The repaired behavior: fail
 * loudly with a named error naming the agent id (surfaced through resumeAgent's
 * standard { success: false, error } result and the `resumeAgent FAILED`
 * lifecycle log). This test drives the real resumeAgent up to that guard with
 * a real on-disk state file (temp OVERDECK_HOME) and only the non-model
 * dependencies mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';

vi.mock('../../../../src/lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logAgentLifecycle: vi.fn(),
}));

vi.mock('../../../../src/lib/review-lifecycle-guard.js', () => ({
  withReviewLifecycleGuardForAgent: (_id: string, fn: () => unknown) => fn(),
}));

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  resolveProjectFromIssueSync: vi.fn(() => null),
}));

vi.mock('../../../../src/lib/agents/activity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents/activity.js')>()),
  resolveLatestSessionId: vi.fn(() => ({
    sessionId: 'sess-123',
    checked: ['mock'],
  })),
  saveSessionId: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/spawn-prep.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents/spawn-prep.js')>()),
  assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tmux.js')>()),
  sessionExists: vi.fn(() => Effect.succeed(false)),
  isPaneDead: vi.fn(() => Effect.succeed(true)),
  killSession: vi.fn(() => Effect.succeed(undefined)),
  createSession: vi.fn(() => Effect.succeed(undefined)),
  listPaneValues: vi.fn(async () => []),
}));

import { resumeAgent } from '../../../../src/lib/agents/resume.js';

let tempHome: string;
let prevOverdeckHome: string | undefined;
let workspaceDir: string;

const AGENT_ID = 'agent-pan-3859';

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'pan-3859-resume-'));
  prevOverdeckHome = process.env.OVERDECK_HOME;
  process.env.OVERDECK_HOME = tempHome;
  workspaceDir = join(tempHome, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(tempHome, 'agents', AGENT_ID), { recursive: true });
});

afterEach(() => {
  if (prevOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = prevOverdeckHome;
  rmSync(tempHome, { recursive: true, force: true });
});

function writeState(extra: Record<string, unknown>): void {
  writeFileSync(
    join(tempHome, 'agents', AGENT_ID, 'state.json'),
    JSON.stringify({
      id: AGENT_ID,
      issueId: 'PAN-3859',
      workspace: workspaceDir,
      harness: 'claude-code',
      role: 'work',
      status: 'stopped',
      startedAt: new Date().toISOString(),
      ...extra,
    }),
  );
}

describe('PAN-3859 resume hardcoded-fallback no-loss audit', () => {
  it('a state file with no model and no override fails loudly, naming the agent', async () => {
    writeState({}); // no model key at all — the state the fallback used to paper over

    const result = await resumeAgent(AGENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      `Cannot resume ${AGENT_ID}: agent state has no model and no model override was requested (PAN-3859: no hardcoded fallback)`,
    );
  });

  it('a state file with an empty-string model also fails loudly', async () => {
    writeState({ model: '' });

    const result = await resumeAgent(AGENT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain(`Cannot resume ${AGENT_ID}: agent state has no model`);
  });
});
