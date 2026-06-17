/**
 * Tests for GET /api/health/agents membership source (PAN-1914)
 *
 * Verifies that the endpoint discovers agents from the SQLite agents table
 * (PAN-1908) instead of scanning ~/.panopticon/agents with readdir.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mockListAllAgents = vi.hoisted(() => vi.fn());
const mockDetermineHealthStatus = vi.hoisted(() => vi.fn());
const mockListSessionNames = vi.hoisted(() => vi.fn());

vi.mock('../../../../lib/database/agents-db.js', () => ({
  listAllAgents: mockListAllAgents,
}));

vi.mock('../../../lib/health-filtering.js', () => ({
  determineHealthStatus: mockDetermineHealthStatus,
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNames: mockListSessionNames,
}));

import { buildHealthAgentsResponse } from '../misc.js';

describe('buildHealthAgentsResponse', () => {
  let agentsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    agentsDir = mkdtempSync(join(tmpdir(), 'pan-health-agents-'));
  });

  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
  });

  it('sources membership from the agents table, not readdir', async () => {
    mockListAllAgents.mockReturnValue([
      { id: 'agent-pan-1914' },
      { id: 'planning-pan-1914' },
      { id: 'specialist-pan-1914' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(new Set<string>()));
    mockDetermineHealthStatus.mockImplementation((_agentId: string, _stateFile: string, liveSessions: Set<string>) =>
      Effect.succeed({ status: 'healthy' }),
    );

    const result = await buildHealthAgentsResponse(
      mockListAllAgents(),
      new Set(),
      agentsDir,
    );

    expect(result).toHaveLength(3);
    expect(result.map(a => a.agentId).sort()).toEqual([
      'agent-pan-1914',
      'planning-pan-1914',
      'specialist-pan-1914',
    ]);
  });

  it('filters out agents that determineHealthStatus marks as hidden', async () => {
    mockListAllAgents.mockReturnValue([
      { id: 'agent-pan-1914' },
      { id: 'agent-stopped' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(new Set<string>()));
    mockDetermineHealthStatus.mockImplementation((agentId: string) =>
      agentId === 'agent-stopped'
        ? Effect.succeed(null)
        : Effect.succeed({ status: 'healthy' }),
    );

    const result = await buildHealthAgentsResponse(
      mockListAllAgents(),
      new Set(),
      agentsDir,
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe('agent-pan-1914');
  });

  it('reads per-agent health.json and context-pct for enrichment', async () => {
    const agentId = 'agent-pan-1914';
    const agentDir = join(agentsDir, agentId);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'health.json'), JSON.stringify({ consecutiveFailures: 3, killCount: 1 }));
    writeFileSync(join(agentDir, 'context-pct'), '87');

    mockListAllAgents.mockReturnValue([{ id: agentId }]);
    mockListSessionNames.mockReturnValue(Effect.succeed(new Set<string>()));
    mockDetermineHealthStatus.mockReturnValue(Effect.succeed({ status: 'healthy' }));

    const result = await buildHealthAgentsResponse(
      mockListAllAgents(),
      new Set(),
      agentsDir,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agentId,
      status: 'healthy',
      consecutiveFailures: 3,
      killCount: 1,
      contextPercent: 87,
    });
  });
});
