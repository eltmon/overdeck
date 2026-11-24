/**
 * PAN-5652 review: specialist state records no harness, and the liveness oracle
 * assumes claude-code when none is recorded. A live pane without a claude-code
 * process must not read as a stopped specialist, or startup reconciliation
 * resets a live specialist to idle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isAlive: vi.fn(),
  getAgentState: vi.fn(),
}));

vi.mock('../../../../src/lib/agents/liveness.js', () => ({ isAlive: mocks.isAlive }));
vi.mock('../../../../src/lib/agents/agent-state-read.js', () => ({ getAgentState: mocks.getAgentState }));

import { specialistSessionState } from '../../../../src/lib/cloister/specialists-status.js';

describe('specialistSessionState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgentState.mockReturnValue(null);
  });

  it('is running when the oracle confirms the harness', async () => {
    mocks.isAlive.mockResolvedValue({ alive: true, paneAlive: true });
    await expect(specialistSessionState('specialist-overdeck-review-agent')).resolves.toBe('running');
  });

  it('is running when the pane is live but no harness is recorded to look for', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-missing' });
    await expect(specialistSessionState('specialist-overdeck-review-agent')).resolves.toBe('running');
  });

  it('is stopped when the recorded harness is missing from a live pane', async () => {
    mocks.getAgentState.mockReturnValue({ harness: 'codex' });
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-missing' });
    await expect(specialistSessionState('specialist-overdeck-review-agent')).resolves.toBe('stopped');
  });

  it('is unknown, never stopped, when the probe cannot answer', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'runtime-indeterminate' });
    await expect(specialistSessionState('specialist-overdeck-review-agent')).resolves.toBe('unknown');
  });

  it('is stopped when the session is gone', async () => {
    mocks.isAlive.mockResolvedValue({ alive: false, reason: 'no-session' });
    await expect(specialistSessionState('specialist-overdeck-review-agent')).resolves.toBe('stopped');
  });
});
