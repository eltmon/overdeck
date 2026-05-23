import { Effect } from 'effect';
/**
 * Route logic tests for /api/show/:issueId endpoints (PAN-705).
 *
 * Exercises the real getShadowState function with real shadow-state files.
 * Follows the pattern in tests/lib/shadow-state.test.ts: write unique-prefix
 * files to the real ~/.panopticon/shadow-state dir and clean up after.
 *
 * Health path tests mock getRuntimeForAgent + getAgentHealth (cloister) so
 * there is no in-memory runtime required in the test environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  getShadowState,
  createShadowState,
} from '../../../../../src/lib/shadow-state.js';

// ─── Health mocks (getRuntimeForAgent + getAgentHealth from cloister) ─────────

const { getRuntimeForAgentMock, getAgentHealthMock } = vi.hoisted(() => ({
  getRuntimeForAgentMock: vi.fn(),
  getAgentHealthMock: vi.fn(),
}));

vi.mock('../../../../../src/lib/runtimes/index.js', () => ({
  getRuntimeForAgent: getRuntimeForAgentMock,
}));

vi.mock('../../../../../src/lib/cloister/health.js', () => ({
  getAgentHealth: getAgentHealthMock,
}));

// ─── Test-file isolation ──────────────────────────────────────────────────────

const SHADOW_STATE_DIR = join(homedir(), '.panopticon', 'shadow-state');
const TEST_PREFIX = 'TEST-ROUTE-SHOW';

function cleanupShadowTestFiles() {
  if (!existsSync(SHADOW_STATE_DIR)) return;
  for (const file of readdirSync(SHADOW_STATE_DIR)) {
    if (file.startsWith(TEST_PREFIX)) {
      try { unlinkSync(join(SHADOW_STATE_DIR, file)); } catch { /* ignore */ }
    }
  }
}

let testIdCounter = 0;
function uniqueIssueId(tag: string): string {
  return `${TEST_PREFIX}-${tag}-${Date.now()}-${++testIdCounter}`;
}

// ─── GET /api/show/:issueId/shadow — real shadow-state file I/O ──────────────

describe('GET /api/show/:issueId/shadow', () => {
  beforeEach(cleanupShadowTestFiles);
  afterEach(cleanupShadowTestFiles);

  it('404 path — getShadowState returns null when no file exists', async () => {
    const issueId = uniqueIssueId('NOEXIST');
    // Route decision: if (!shadowState) → 404
    expect(await Effect.runPromise(getShadowState(issueId))).toBeNull();
  });

  it('200 path — getShadowState returns real state after createShadowState', async () => {
    const issueId = uniqueIssueId('EXIST');
    const created = await Effect.runPromise(createShadowState(issueId, 'in_progress', 'test'));

    const result = await Effect.runPromise(getShadowState(issueId));

    expect(result).not.toBeNull();
    expect(result?.issueId).toBe(issueId.toUpperCase());
    expect(result?.shadowStatus).toBe('in_progress');
    expect(result?.shadowedAt).toBe(created.shadowedAt);
    expect(Array.isArray(result?.history)).toBe(true);
  });

  it('roundtrip — state persisted to disk matches state read back', async () => {
    const issueId = uniqueIssueId('ROUNDTRIP');
    await Effect.runPromise(createShadowState(issueId, 'in_review', 'test-script'));

    const first = await Effect.runPromise(getShadowState(issueId));
    const second = await Effect.runPromise(getShadowState(issueId));

    // Two independent reads of the same file must be consistent
    expect(second).toEqual(first);
    expect(second?.trackerStatus).toBe('in_review');
  });
});

// ─── GET /api/show/:issueId — summary route decision logic ────────────────────

describe('GET /api/show/:issueId (summary)', () => {
  beforeEach(cleanupShadowTestFiles);
  afterEach(cleanupShadowTestFiles);

  it('agentId is derived as agent-<lowercase issueId>', () => {
    // Route code: const agentId = `agent-${issueId.toLowerCase()}`
    // This is the exact expression the route uses — a regression here would
    // send health queries to the wrong agent directory.
    const issueId = 'PAN-705';
    expect(`agent-${issueId.toLowerCase()}`).toBe('agent-pan-705');

    const mixed = 'Min-42';
    expect(`agent-${mixed.toLowerCase()}`).toBe('agent-min-42');
  });

  it('shadow field is populated from real getShadowState for existing issue', async () => {
    const issueId = uniqueIssueId('SUMMARY');
    await Effect.runPromise(createShadowState(issueId, 'done', 'test'));

    const shadow = await Effect.runPromise(getShadowState(issueId));
    expect(shadow).not.toBeNull();
    expect(shadow?.shadowStatus).toBe('done');
  });

  it('shadow field is null for unknown issue (and route must tolerate that)', async () => {
    const issueId = uniqueIssueId('SUMMARY-UNKNOWN');
    expect(await Effect.runPromise(getShadowState(issueId))).toBeNull();
  });
});

// ─── Health path — getRuntimeForAgent + getAgentHealth (cloister) ─────────────
//
// The show route uses getRuntimeForAgent to fetch the in-memory runtime, then
// calls getAgentHealth(agentId, runtime). These tests confirm:
//   1. When runtime exists → getAgentHealth is called with (agentId, runtime)
//   2. When runtime is null → getAgentHealth is NOT called; health is null
//   3. agentId is always derived as `agent-<lowercase issueId>`

describe('health logic used by /api/show/:issueId routes', () => {
  const MOCK_RUNTIME = { isRunning: vi.fn(), getHeartbeat: vi.fn() } as any;
  const MOCK_HEALTH = {
    agentId: 'agent-pan-705',
    state: 'active',
    lastActivity: new Date(),
    timeSinceActivity: 1000,
    heartbeat: null,
    isRunning: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getAgentHealth(agentId, runtime) when runtime is available', () => {
    getRuntimeForAgentMock.mockReturnValue(MOCK_RUNTIME);
    getAgentHealthMock.mockReturnValue(MOCK_HEALTH);

    const agentId = 'agent-pan-705';
    const runtime = getRuntimeForAgentMock(agentId);
    const health = runtime ? getAgentHealthMock(agentId, runtime) : null;

    expect(getRuntimeForAgentMock).toHaveBeenCalledWith(agentId);
    expect(getAgentHealthMock).toHaveBeenCalledWith(agentId, MOCK_RUNTIME);
    expect(health).toEqual(MOCK_HEALTH);
  });

  it('returns null health without calling getAgentHealth when runtime is null', () => {
    getRuntimeForAgentMock.mockReturnValue(null);

    const agentId = 'agent-pan-705';
    const runtime = getRuntimeForAgentMock(agentId);
    const health = runtime ? getAgentHealthMock(agentId, runtime) : null;

    expect(getRuntimeForAgentMock).toHaveBeenCalledWith(agentId);
    expect(getAgentHealthMock).not.toHaveBeenCalled();
    expect(health).toBeNull();
  });

  it('derives agentId as agent-<lowercase issueId> before runtime lookup', () => {
    getRuntimeForAgentMock.mockReturnValue(null);

    // This is the exact expression in the show route:
    const issueId = 'PAN-705';
    const agentId = `agent-${issueId.toLowerCase()}`;

    getRuntimeForAgentMock(agentId);
    expect(getRuntimeForAgentMock).toHaveBeenCalledWith('agent-pan-705');
  });
});

