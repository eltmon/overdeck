/**
 * PAN-4253: SpawnConfig carries a typed effort and effortSource; the
 * claude-code runtime adapter must forward both to spawnAgent.
 */
import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn(async () => ({
  id: 'agent-pan-1',
  issueId: 'PAN-1',
  workspace: '/tmp/w',
  role: 'work',
  model: 'claude-opus-5-5',
  status: 'starting',
  startedAt: new Date().toISOString(),
}));

vi.mock('../../agents.js', async (importOriginal) => ({
  ...(await importOriginal()),
  spawnAgent: spawnMock,
}));

const { ClaudeCodeRuntimeSync } = await import('../claude-code.js');

describe('ClaudeCodeRuntimeSync.spawnAgent forwards effort (PAN-4253)', () => {
  it('passes effort and effortSource through to spawnAgentImpl', async () => {
    const runtime = new ClaudeCodeRuntimeSync();

    await runtime.spawnAgent({
      agentId: 'agent-pan-1',
      workspace: '/tmp/w',
      effort: 'max',
      effortSource: 'role',
    });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'max', effortSource: 'role' }),
    );
  });
});
