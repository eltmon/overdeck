import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testMocks = vi.hoisted(() => ({
  agentsDir: `/tmp/pan-service-completion-${process.pid}`,
  ensureInternalTokenSync: vi.fn(() => 'test-internal-token'),
  getReviewStatusSync: vi.fn(() => null),
}));

vi.mock('../../paths.js', () => ({
  AGENTS_DIR: testMocks.agentsDir,
}));

vi.mock('../../internal-token.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../internal-token.js')>(),
  ensureInternalTokenSync: testMocks.ensureInternalTokenSync,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusSync: testMocks.getReviewStatusSync,
}));

import { INTERNAL_TOKEN_HEADER } from '../../internal-token.js';
import { checkCompletionMarkers } from '../service-completion.js';

describe('checkCompletionMarkers review trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rmSync(testMocks.agentsDir, { recursive: true, force: true });
    const agentDir = join(testMocks.agentsDir, 'agent-pan-3340');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'completed'), JSON.stringify({
      timestamp: new Date().toISOString(),
    }));
    testMocks.ensureInternalTokenSync.mockClear();
    testMocks.getReviewStatusSync.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    rmSync(testMocks.agentsDir, { recursive: true, force: true });
  });

  it('authenticates Cloister automatic review dispatch with the internal token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await checkCompletionMarkers({
      processedCompletions: new Map(),
      getDashboardApiUrl: () => 'http://localhost:3011',
    });

    expect(testMocks.ensureInternalTokenSync).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3011/api/review/PAN-3340/trigger',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [INTERNAL_TOKEN_HEADER]: 'test-internal-token',
        }),
      }),
    );
  });
});
