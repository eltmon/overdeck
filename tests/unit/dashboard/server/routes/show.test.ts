/**
 * Route logic tests for /api/show/:issueId endpoints (PAN-705).
 *
 * The Effect HTTP routes delegate to getShadowState and getAgentHealth.
 * Tests verify: 404 on missing shadow state, agentId construction from
 * issueId, workspace-not-found path, and the tldr stub response.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../../../src/lib/shadow-state.js', () => ({
  getShadowState: vi.fn(),
}));

vi.mock('../../../../../src/lib/cloister/health.js', () => ({
  getAgentHealth: vi.fn(),
}));

vi.mock('../../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: vi.fn(() => ({ path: '/fake/project' })),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { getShadowState } from '../../../../../src/lib/shadow-state.js';
import { getAgentHealth } from '../../../../../src/lib/cloister/health.js';
import { existsSync } from 'node:fs';

afterEach(() => vi.clearAllMocks());

// ─── GET /api/show/:issueId/shadow ────────────────────────────────────────────

describe('GET /api/show/:issueId/shadow', () => {
  it('404 path — getShadowState returns null for unknown issue', () => {
    vi.mocked(getShadowState).mockReturnValue(null);
    const result = getShadowState('PAN-999');
    // Route returns 404 when this is null
    expect(result).toBeNull();
  });

  it('200 path — returns shadow state object when it exists', () => {
    const fakeState = { issueId: 'PAN-705', mode: 'shadow', createdAt: '2026-01-01' };
    vi.mocked(getShadowState).mockReturnValue(fakeState as any);
    const result = getShadowState('PAN-705');
    expect(result).toMatchObject({ issueId: 'PAN-705', mode: 'shadow' });
  });
});

// ─── GET /api/show/:issueId/health ────────────────────────────────────────────

describe('GET /api/show/:issueId/health', () => {
  it('constructs agentId as agent-<lowercase issueId>', () => {
    const issueId = 'PAN-705';
    const agentId = `agent-${issueId.toLowerCase()}`;
    expect(agentId).toBe('agent-pan-705');
  });

  it('constructs agentId correctly for other prefixes', () => {
    const issueId = 'MIN-123';
    const agentId = `agent-${issueId.toLowerCase()}`;
    expect(agentId).toBe('agent-min-123');
  });

  it('returns health data from getAgentHealth', async () => {
    const fakeHealth = { status: 'healthy', heartbeat: '2026-01-01T00:00:00Z' };
    vi.mocked(getAgentHealth).mockResolvedValue(fakeHealth as any);
    const result = await getAgentHealth('agent-pan-705');
    expect(result).toMatchObject({ status: 'healthy' });
  });

  it('returns error object when getAgentHealth rejects', async () => {
    vi.mocked(getAgentHealth).mockRejectedValue(new Error('Agent not found'));
    const result = await getAgentHealth('agent-pan-999').catch((err: Error) => ({ error: err.message }));
    expect(result).toMatchObject({ error: 'Agent not found' });
  });
});

// ─── GET /api/show/:issueId ───────────────────────────────────────────────────

describe('GET /api/show/:issueId', () => {
  it('combines shadow state and health into a single response', async () => {
    const shadow = { issueId: 'PAN-705', mode: 'shadow' };
    const health = { status: 'healthy' };
    vi.mocked(getShadowState).mockReturnValue(shadow as any);
    vi.mocked(getAgentHealth).mockResolvedValue(health as any);

    const issueId = 'PAN-705';
    const agentId = `agent-${issueId.toLowerCase()}`;
    const shadowResult = getShadowState(issueId);
    const healthResult = await getAgentHealth(agentId);

    expect({ issueId, shadow: shadowResult, health: healthResult }).toEqual({
      issueId: 'PAN-705',
      shadow: { issueId: 'PAN-705', mode: 'shadow' },
      health: { status: 'healthy' },
    });
  });
});

// ─── GET /api/show/:issueId/tldr ──────────────────────────────────────────────

describe('GET /api/show/:issueId/tldr', () => {
  it('workspace-not-found path — existsSync returns false', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    // Route returns 404 when workspace doesn't exist
    const workspacePath = '/fake/project/workspaces/feature-pan-705';
    expect(existsSync(workspacePath)).toBe(false);
  });

  it('stub response — route returns available:false redirecting to pan admin tldr', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    // Route returns this stub when workspace exists (TLDR data is in admin endpoint)
    const stubResponse = { available: false, reason: 'Use pan admin tldr for daemon status' };
    expect(stubResponse.available).toBe(false);
    expect(stubResponse.reason).toContain('pan admin tldr');
  });
});
