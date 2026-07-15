import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { join } from 'node:path';
import { homedir } from 'node:os';

const homeDir = homedir();

vi.mock('../../../../../src/lib/agents.js', () => ({
  getAgentRuntimeState: vi.fn((id: string) => Effect.succeed(mockRuntimeStates.get(id) ?? null)),
  getAgentStateSync: vi.fn((id: string) => mockAgentStates.get(id) ?? null),
  listRunningAgents: vi.fn(() => []),
}));

vi.mock('../../../../../src/lib/tmux.js', () => ({
  listSessionNames: vi.fn(() => Effect.succeed([])),
  capturePane: vi.fn(() => Effect.succeed('')),
}));

vi.mock('../../../../../src/lib/agent-input-detection.js', () => ({
  detectAwaitingInputFromPaneSync: vi.fn(() => null),
  detectAwaitingInputForAgent: vi.fn(() => Effect.succeed(null)),
}));

vi.mock('../../../../../src/dashboard/server/services/session-presence.js', () => ({
  deriveSessionPresence: vi.fn(async (_id: string, rtState: { state: string } | null, tmuxSessionNames: Set<string>) => {
    if (!tmuxSessionNames.has(_id)) return 'ended';
    if (!rtState) return 'idle';
    if (rtState.state === 'active') return 'active';
    if (rtState.state === 'suspended') return 'suspended';
    return 'idle';
  }),
}));

vi.mock('../../../../../src/dashboard/server/review-status.js', () => ({
  getReviewStatusSync: vi.fn(() => null),
}));

vi.mock('../../../../../src/dashboard/server/routes/jsonl-resolver.js', () => ({
  resolveJsonlPath: vi.fn(async () => null),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: vi.fn(() => ({ projectPath: '/tmp/overdeck' })),
  listProjectsSync: vi.fn(() => []),
  resolveProjectFromIssue: vi.fn(),
}));

const mockIsPlanningComplete = vi.hoisted(() => vi.fn(() => Effect.succeed(false)));
vi.mock('../../../../../src/lib/vbrief/io.js', () => ({
  isPlanningComplete: mockIsPlanningComplete,
  readWorkspacePlan: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises') as object;
  return {
    ...actual,
    access: vi.fn((p: string) => {
      if (p.startsWith(join(homeDir, '.overdeck', 'agents'))) return Promise.resolve(undefined);
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    }),
    readFile: vi.fn(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    }),
    stat: vi.fn(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return Promise.reject(err);
    }),
    readdir: vi.fn(() => Promise.resolve([])),
  };
});

import { extractReviewerRole, fetchActivityDataWithContext } from '../../../../../src/dashboard/server/routes/command-deck.ts';

const mockAgentStates = vi.hoisted(() => new Map<string, any>());
const mockRuntimeStates = vi.hoisted(() => new Map<string, any>());

describe('extractReviewerRole', () => {
  it('extracts role from standard review session name', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-correctness', 'PAN-821');
    expect(result).toBe('correctness');
  });

  it('extracts role for security reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-security', 'PAN-821');
    expect(result).toBe('security');
  });

  it('extracts role for performance reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-performance', 'PAN-821');
    expect(result).toBe('performance');
  });

  it('extracts role for requirements reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-requirements', 'PAN-821');
    expect(result).toBe('requirements');
  });

  it('extracts role for synthesis reviewer', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-synthesis', 'PAN-821');
    expect(result).toBe('synthesis');
  });

  it('returns null for session without role suffix', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890', 'PAN-821');
    expect(result).toBeNull();
  });

  it('returns null for non-review session name', () => {
    const result = extractReviewerRole('agent-pan-821', 'PAN-821');
    expect(result).toBeNull();
  });

  it('returns null for coordinator session', () => {
    const result = extractReviewerRole('review-coordinator-PAN-821-1745567890', 'PAN-821');
    expect(result).toBeNull();
  });

  it('is case-insensitive for issueId matching', () => {
    const result = extractReviewerRole('review-pan-821-1745567890-correctness', 'PAN-821');
    expect(result).toBe('correctness');
  });

  it('returns null for empty role after timestamp', () => {
    const result = extractReviewerRole('review-PAN-821-1745567890-', 'PAN-821');
    expect(result).toBeNull();
  });
});

describe('fetchActivityDataWithContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentStates.clear();
    mockRuntimeStates.clear();
    mockIsPlanningComplete.mockReturnValue(Effect.succeed(false));
  });

  it('leaves endedAt undefined for a live work session', async () => {
    const issueId = 'PAN-539';
    const agentId = 'agent-pan-539';
    mockAgentStates.set(agentId, {
      id: agentId,
      issueId,
      role: 'work',
      model: 'gpt-4',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });
    mockRuntimeStates.set(agentId, { state: 'active' });

    const result = await fetchActivityDataWithContext(issueId, { tmuxSessionNames: new Set([agentId]) });
    const section = (result as { sections: Array<{ sessionId: string; endedAt?: string; duration: number | null }> }).sections
      .find((s) => s.sessionId === agentId);

    expect(section).toBeDefined();
    expect(section?.endedAt).toBeUndefined();
    expect(typeof section?.duration).toBe('number');
    expect(Number.isFinite(section?.duration)).toBe(true);
  });

  it('populates endedAt when the session has ended', async () => {
    const issueId = 'PAN-539';
    const agentId = 'agent-pan-539';
    mockAgentStates.set(agentId, {
      id: agentId,
      issueId,
      role: 'work',
      model: 'gpt-4',
      status: 'stopped',
      startedAt: '2026-01-01T00:00:00Z',
      stoppedAt: '2026-01-01T02:30:00Z',
    });

    const result = await fetchActivityDataWithContext(issueId, { tmuxSessionNames: new Set() });
    const section = (result as { sections: Array<{ sessionId: string; endedAt?: string; duration: number | null }> }).sections
      .find((s) => s.sessionId === agentId);

    expect(section).toBeDefined();
    expect(section?.endedAt).toBe('2026-01-01T02:30:00Z');
    expect(typeof section?.duration).toBe('number');
    expect(Number.isFinite(section?.duration)).toBe(true);
  });

  it('sets planningComplete on planning sections only when planning is finished', async () => {
    const issueId = 'PAN-539';
    const planningId = 'planning-pan-539';
    const workId = 'agent-pan-539';
    mockAgentStates.set(planningId, {
      id: planningId,
      issueId,
      role: 'plan',
      model: 'gpt-4',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });
    mockAgentStates.set(workId, {
      id: workId,
      issueId,
      role: 'work',
      model: 'gpt-4',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });
    mockRuntimeStates.set(planningId, { state: 'active' });
    mockRuntimeStates.set(workId, { state: 'active' });
    mockIsPlanningComplete.mockReturnValue(Effect.succeed(true));

    const result = await fetchActivityDataWithContext(issueId, { tmuxSessionNames: new Set([planningId, workId]) });
    const sections = (result as { sections: Array<{ sessionId: string; planningComplete?: boolean; duration: number | null }> }).sections;
    const planning = sections.find((s) => s.sessionId === planningId);
    const work = sections.find((s) => s.sessionId === workId);

    expect(planning?.planningComplete).toBe(true);
    expect(work?.planningComplete).toBeUndefined();
    expect(typeof planning?.duration).toBe('number');
    expect(Number.isFinite(planning?.duration)).toBe(true);
    expect(typeof work?.duration).toBe('number');
    expect(Number.isFinite(work?.duration)).toBe(true);
  });

  it('classifies agent-<issue>-plan as a planning section', async () => {
    const issueId = 'PAN-901';
    const planId = 'agent-pan-901-plan';
    mockAgentStates.set(planId, {
      id: planId,
      issueId,
      role: 'plan',
      model: 'gpt-4',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
    });
    mockRuntimeStates.set(planId, { state: 'active' });

    const result = await fetchActivityDataWithContext(issueId, { tmuxSessionNames: new Set([planId]) });
    const sections = (result as { sections: Array<{ sessionId: string; type: string; planningComplete?: boolean }> }).sections;
    const planning = sections.find((s) => s.sessionId === planId);

    expect(planning).toBeDefined();
    expect(planning?.type).toBe('planning');
    expect(planning?.planningComplete).toBe(false);
  });
});
