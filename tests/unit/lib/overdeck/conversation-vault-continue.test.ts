import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  markConversationActive: vi.fn(),
  updateForkStatus: vi.fn(),
  ensureForkSessionReady: vi.fn(),
  injectForkSummary: vi.fn(),
  handleForkPipelineFailure: vi.fn(),
  registerInFlightForkPipeline: vi.fn((pipeline: Promise<void>) => pipeline),
}));

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  createConversation: mocks.createConversation,
  markConversationActive: mocks.markConversationActive,
  updateForkStatus: mocks.updateForkStatus,
}));

vi.mock('../../../../src/lib/overdeck/conversation-forks.js', () => ({
  ensureForkSessionReady: mocks.ensureForkSessionReady,
  injectForkSummary: mocks.injectForkSummary,
  handleForkPipelineFailure: mocks.handleForkPipelineFailure,
  registerInFlightForkPipeline: mocks.registerInFlightForkPipeline,
}));

import {
  allocateVaultContinueNames,
  createVaultContinuedConversation,
  launchVaultContinuedConversation,
} from '../../../../src/lib/overdeck/conversation-vault-continue.js';
import type { LegacyConversation } from '../../../../src/lib/overdeck/conversations.js';

const SESSION = '11111111-2222-4333-8444-555555555555';

function conv(): LegacyConversation {
  return { name: '20260930-abcd', tmuxSession: 'conv-20260930-abcd', claudeSessionId: SESSION, harness: 'claude-code' } as LegacyConversation;
}

const input = {
  name: '20260930-abcd',
  tmuxSession: 'conv-20260930-abcd',
  cwd: '/src/widget',
  newSessionId: SESSION,
  harness: 'claude-code' as const,
  title: 'Fix the parser',
  model: 'claude-opus-5-5',
  projectKey: 'widget',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createConversation.mockImplementation((opts: { name: string }) => ({ ...conv(), name: opts.name }));
  mocks.ensureForkSessionReady.mockResolvedValue(undefined);
  mocks.injectForkSummary.mockResolvedValue('submitted');
});

describe('allocateVaultContinueNames', () => {
  it('follows the plain-fork naming rule', () => {
    const names = allocateVaultContinueNames(new Date('2026-09-30T12:00:00Z'));
    expect(names.name).toMatch(/^20260930-[0-9a-f]{4}$/);
    expect(names.tmuxSession).toBe(`conv-${names.name}`);
  });
});

describe('createVaultContinuedConversation (PAN-4437 WI-3)', () => {
  it('ac: the row carries the session id, cwd, harness and spawning status, and no effort', () => {
    createVaultContinuedConversation(input);
    expect(mocks.createConversation).toHaveBeenCalledTimes(1);
    const opts = mocks.createConversation.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).toMatchObject({
      name: input.name,
      tmuxSession: input.tmuxSession,
      cwd: '/src/widget',
      claudeSessionId: SESSION,
      harness: 'claude-code',
      title: 'Fix the parser',
      titleSource: 'manual',
      model: 'claude-opus-5-5',
      projectKey: 'widget',
      forkStatus: 'spawning',
    });
    expect(opts).not.toHaveProperty('effort');
    expect(opts).not.toHaveProperty('parentName');
    expect(mocks.markConversationActive).toHaveBeenCalledWith(input.name);
  });

  it('omits an unsafe model string', () => {
    createVaultContinuedConversation({ ...input, model: 'x; rm -rf /' });
    expect((mocks.createConversation.mock.calls[0]![0] as Record<string, unknown>).model).toBeUndefined();
    createVaultContinuedConversation({ ...input, model: null });
    expect((mocks.createConversation.mock.calls[1]![0] as Record<string, unknown>).model).toBeUndefined();
  });
});

describe('launchVaultContinuedConversation (PAN-4437 WI-3)', () => {
  it('ac: resumes the session and never delivers a note when none is given', async () => {
    const c = conv();
    await launchVaultContinuedConversation(c, null);
    expect(mocks.registerInFlightForkPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.ensureForkSessionReady).toHaveBeenCalledWith(c, SESSION, true, true);
    expect(mocks.injectForkSummary).not.toHaveBeenCalled();
    expect(mocks.markConversationActive).toHaveBeenCalledWith(c.name);
    expect(mocks.updateForkStatus).toHaveBeenCalledWith(c.name, null);
    expect(mocks.handleForkPipelineFailure).not.toHaveBeenCalled();
  });

  it('ac: delivers the note once with the vault-continue caller', async () => {
    const c = conv();
    await launchVaultContinuedConversation(c, 'drift note');
    expect(mocks.injectForkSummary).toHaveBeenCalledTimes(1);
    expect(mocks.injectForkSummary).toHaveBeenCalledWith(c, 'drift note', 'vault-continue');
  });

  it('a stranded note fails the row', async () => {
    mocks.injectForkSummary.mockResolvedValue('stranded');
    const c = conv();
    await launchVaultContinuedConversation(c, 'drift note');
    expect(mocks.handleForkPipelineFailure).toHaveBeenCalledWith(c.name, expect.objectContaining({ message: `Drift note was not accepted by ${c.name}` }));
    expect(mocks.updateForkStatus).not.toHaveBeenCalledWith(c.name, null);
  });

  it('a throwing spawn calls handleForkPipelineFailure and does not reject', async () => {
    const error = new Error('spawn failed');
    mocks.ensureForkSessionReady.mockRejectedValue(error);
    const c = conv();
    await expect(launchVaultContinuedConversation(c, null)).resolves.toBeUndefined();
    expect(mocks.handleForkPipelineFailure).toHaveBeenCalledWith(c.name, error);
    expect(mocks.markConversationActive).not.toHaveBeenCalled();
  });
});
