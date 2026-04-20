/**
 * Tests for `pan show <id>` unified observation command.
 *
 * --shadow, --cv, --context, --health each delegate to the full sub-command
 * for detail views. The default path builds a compact combined summary
 * directly from the underlying library functions (no sub-command delegation)
 * so the output stays ≤ 25 lines.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  shadowMock, cvMock, contextMock, healthMock,
  getShadowStateMock, pingAgentMock, getAgentCVMock, getAgentRuntimeStateMock,
} = vi.hoisted(() => ({
  shadowMock: vi.fn().mockResolvedValue(undefined),
  cvMock: vi.fn().mockResolvedValue(undefined),
  contextMock: vi.fn().mockResolvedValue(undefined),
  healthMock: vi.fn().mockResolvedValue(undefined),
  getShadowStateMock: vi.fn(),
  pingAgentMock: vi.fn(),
  getAgentCVMock: vi.fn(),
  getAgentRuntimeStateMock: vi.fn(),
}));

vi.mock('../../../src/cli/commands/shadow.js', () => ({
  shadowCommand: shadowMock,
}));
vi.mock('../../../src/cli/commands/cv.js', () => ({
  cvCommand: cvMock,
}));
vi.mock('../../../src/cli/commands/context.js', () => ({
  contextCommand: contextMock,
}));
vi.mock('../../../src/cli/commands/health.js', () => ({
  healthCommand: healthMock,
}));

vi.mock('../../../src/lib/shadow-state.js', () => ({
  getShadowState: getShadowStateMock,
}));
vi.mock('../../../src/lib/health.js', () => ({
  pingAgent: pingAgentMock,
}));
vi.mock('../../../src/lib/cv.js', () => ({
  getAgentCV: getAgentCVMock,
}));
vi.mock('../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: getAgentRuntimeStateMock,
}));

import { showCommand } from '../../../src/cli/commands/show.js';

describe('showCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reasonable defaults for the compact-default-path tests; individual tests
    // can override via mockReturnValue / mockResolvedValue.
    getShadowStateMock.mockResolvedValue(null);
    pingAgentMock.mockResolvedValue({
      agentId: 'agent-pan-6',
      status: 'healthy',
      consecutiveFailures: 0,
      forceKillCount: 0,
      recoveryCount: 0,
      inCooldown: false,
      lastActivity: new Date().toISOString(),
    });
    getAgentCVMock.mockReturnValue({
      agentId: 'agent-pan-6',
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      runtime: 'claude',
      model: 'sonnet',
      stats: {
        totalIssues: 0,
        successCount: 0,
        failureCount: 0,
        abandonedCount: 0,
        avgDuration: 0,
        successRate: 0,
      },
      skillsUsed: [],
      recentWork: [],
    });
    getAgentRuntimeStateMock.mockReturnValue(null);
  });

  describe('flag delegation', () => {
    it('--shadow: delegates exclusively to shadowCommand', async () => {
      await showCommand('PAN-1', { shadow: true });
      expect(shadowMock).toHaveBeenCalledWith('PAN-1');
      expect(cvMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--cv: delegates exclusively to cvCommand', async () => {
      await showCommand('PAN-2', { cv: true });
      expect(cvMock).toHaveBeenCalledWith('PAN-2', { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--context: delegates exclusively to contextCommand', async () => {
      await showCommand('PAN-3', { context: true });
      expect(contextMock).toHaveBeenCalledWith('state', 'agent-pan-3', undefined, { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(cvMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('--health: delegates exclusively to healthCommand', async () => {
      await showCommand('PAN-4', { health: true });
      expect(healthMock).toHaveBeenCalledWith('ping', 'PAN-4', { json: undefined });
      expect(shadowMock).not.toHaveBeenCalled();
      expect(cvMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
    });

    it('propagates --json to each delegate view', async () => {
      await showCommand('PAN-5', { cv: true, json: true });
      expect(cvMock).toHaveBeenCalledWith('PAN-5', { json: true });
    });
  });

  describe('default path (no flags) — compact summary', () => {
    it('does NOT delegate to the full sub-commands', async () => {
      await showCommand('PAN-6');

      // The default path must build a compact view directly; calling the
      // full sub-handlers would blow past the 25-line budget.
      expect(shadowMock).not.toHaveBeenCalled();
      expect(cvMock).not.toHaveBeenCalled();
      expect(contextMock).not.toHaveBeenCalled();
      expect(healthMock).not.toHaveBeenCalled();
    });

    it('reads from the shadow-state, health, and cv lib modules directly', async () => {
      await showCommand('PAN-6');
      expect(getShadowStateMock).toHaveBeenCalledWith('PAN-6');
      expect(pingAgentMock).toHaveBeenCalledWith('agent-pan-6');
      expect(getAgentCVMock).toHaveBeenCalledWith('agent-pan-6');
    });

    it('output stays at or below 25 lines (PRD compact-summary requirement)', async () => {
      // Populate every field so the summary is in its longest form — shadow
      // present + healthy + stats + 3 recent work entries.
      const now = new Date().toISOString();
      getShadowStateMock.mockResolvedValue({
        issueId: 'PAN-6',
        shadowStatus: 'in_progress',
        trackerStatus: 'open',
        trackerStatusUpdatedAt: now,
        shadowedAt: now,
        history: [],
      });
      getAgentCVMock.mockReturnValue({
        agentId: 'agent-pan-6',
        createdAt: now,
        lastActive: now,
        runtime: 'claude',
        model: 'sonnet',
        stats: {
          totalIssues: 12,
          successCount: 10,
          failureCount: 2,
          abandonedCount: 0,
          avgDuration: 15,
          successRate: 0.83,
        },
        skillsUsed: ['Read', 'Edit'],
        recentWork: [
          { issueId: 'PAN-100', startedAt: now, completedAt: now, outcome: 'success' },
          { issueId: 'PAN-101', startedAt: now, completedAt: now, outcome: 'failed' },
          { issueId: 'PAN-102', startedAt: now, completedAt: now, outcome: 'abandoned' },
        ],
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await showCommand('PAN-6');
      const lineCount = logSpy.mock.calls.length;
      logSpy.mockRestore();
      expect(lineCount).toBeLessThanOrEqual(25);
    });

    it('--json short-circuits to a single JSON payload (no human-formatted lines)', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await showCommand('PAN-8', { json: true });

      const calls = logSpy.mock.calls.slice();
      logSpy.mockRestore();

      expect(calls).toHaveLength(1);
      const payload = JSON.parse(calls[0][0]);
      expect(payload.issueId).toBe('PAN-8');
      expect(payload.agentId).toBe('agent-pan-8');
      expect(payload).toHaveProperty('shadow');
      expect(payload).toHaveProperty('health');
      expect(payload).toHaveProperty('cv');
    });

    it('shows in-progress work with started time instead of never and uses lastActivity instead of lastPing', async () => {
      const now = new Date().toISOString();
      pingAgentMock.mockResolvedValue({
        agentId: 'agent-pan-446',
        status: 'warning',
        consecutiveFailures: 0,
        forceKillCount: 0,
        recoveryCount: 0,
        inCooldown: false,
        lastPing: new Date(Date.now() + 60_000).toISOString(),
        lastActivity: '2026-04-18T19:32:09-04:00',
      });
      getAgentRuntimeStateMock.mockReturnValue({
        state: 'waiting-on-human',
        lastActivity: '2026-04-18T19:32:09-04:00',
        waitingNotification: 'Claude is waiting for your input',
      });
      getAgentCVMock.mockReturnValue({
        agentId: 'agent-pan-446',
        createdAt: now,
        lastActive: now,
        runtime: 'claude',
        model: 'sonnet',
        stats: {
          totalIssues: 2,
          successCount: 0,
          failureCount: 0,
          abandonedCount: 0,
          avgDuration: 0,
          successRate: 0,
        },
        skillsUsed: [],
        recentWork: [
          { issueId: 'PAN-446', startedAt: '2026-04-18T22:07:38.196Z', outcome: 'in_progress' },
        ],
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await showCommand('PAN-446');
      const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      logSpy.mockRestore();

      expect(output).toContain('waiting on human');
      expect(output).toContain('2 total (0 done, 2 active)');
      expect(output).toContain('in_progress');
      expect(output).toContain('started');
      expect(output).not.toContain('in_progress never');
      expect(output).not.toContain('last activity 0s ago');
    });
  });
});
