import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPrFacts } = vi.hoisted(() => ({ mockGetPrFacts: vi.fn() }));

vi.mock('../../../../src/lib/agents.js', () => ({
  clearAgentPaused: vi.fn(),
  getAgentState: vi.fn(() => null),
  messageAgent: vi.fn(),
  setAgentPaused: vi.fn(),
  stopAgent: vi.fn(),
}));
vi.mock('../../../../src/lib/cloister/feedback-target.js', () => ({
  resolveIssueFeedbackTarget: vi.fn(),
  surfaceIssueFeedbackNeedsYou: vi.fn(),
}));
vi.mock('../../../../src/lib/activity-logger.js', () => ({ emitActivityEntry: vi.fn() }));
vi.mock('../../../../src/lib/cloister/pr-facts.js', () => ({ getPrFacts: mockGetPrFacts }));

import {
  MERGED_VERIFICATION_REASON,
  skipMergedVerification,
} from '../../../../src/lib/cloister/verification-escalation.js';
import {
  readVerificationArtifact,
  writeVerificationArtifact,
} from '../../../../src/lib/cloister/verification-artifact.js';

describe('skipMergedVerification finalizes a running artifact (PAN-4543)', () => {
  let workspace: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    workspace = mkdtempSync(join(tmpdir(), 'verif-merged-skip-'));
    writeVerificationArtifact(workspace, 'PAN-4498', [
      { name: 'lint', passed: true, required: true, output: '', durationMs: 10 },
    ], { currentGate: 'build' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(workspace, { recursive: true, force: true });
  });

  it('rewrites the running latest artifact to skipped when the PR merged', async () => {
    mockGetPrFacts.mockResolvedValue({ merged: true });

    const result = await skipMergedVerification('PAN-4498', 'test', workspace);

    expect(result).toEqual({ outcome: 'skipped', reason: MERGED_VERIFICATION_REASON });
    const latest = readVerificationArtifact(workspace);
    expect(latest?.outcome).toBe('skipped');
    expect(latest?.skipReason).toBe(MERGED_VERIFICATION_REASON);
  });

  it('writes nothing when the PR has not merged', async () => {
    mockGetPrFacts.mockResolvedValue({ merged: false });

    expect(await skipMergedVerification('PAN-4498', 'test', workspace)).toBeNull();
    expect(readVerificationArtifact(workspace)?.outcome).toBe('running');
  });

  it('writes nothing when the caller passes no workspace path', async () => {
    mockGetPrFacts.mockResolvedValue({ merged: true });

    expect(await skipMergedVerification('PAN-4498', 'test')).toEqual({
      outcome: 'skipped',
      reason: MERGED_VERIFICATION_REASON,
    });
    expect(readVerificationArtifact(workspace)?.outcome).toBe('running');
  });
});
