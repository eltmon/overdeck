/**
 * PAN-4242 WI-6 (FR-7, NFR-4): a kickoff whose delivery was refused before any
 * byte was typed is kept as the conversation's held kickoff, so a Start or a
 * resume can send it later. Other failures and a stranded turn keep nothing.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const delivery = vi.hoisted(() => ({
  result: { ok: false, path: 'herdr', failure: 'refused: agent_blocked — the agent is waiting at a dialog' } as Record<string, unknown>,
}));

vi.mock('../../agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents.js')>()),
  waitForReadySignal: vi.fn(async () => true),
  deliverAgentMessage: vi.fn(async () => delivery.result),
}));

const forksModule = await import('../conversation-forks.js');
const { deliverForkSeed, ForkDeliveryRefusedError } = forksModule;
const { createConversation } = await import('../conversations.js');
const { holdKickoff, readHeldKickoff } = await import('../conversation-kickoff-store.js');

let testHome: string;
let originalHome: string | undefined;

function seedConversation(name: string) {
  return createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4242-undelivered-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('deliverForkSeed holds a refused kickoff (PAN-4242)', () => {
  it('classifies a refused delivery as ForkDeliveryRefusedError', async () => {
    const conv = seedConversation('refused-real');

    await expect(forksModule.injectForkSummary(conv, 'kickoff', 'test')).rejects.toBeInstanceOf(ForkDeliveryRefusedError);
  });

  it('holds the seed and rethrows on a refusal', async () => {
    const conv = seedConversation('refused');
    vi.spyOn(forksModule, 'injectForkSummary').mockRejectedValue(new ForkDeliveryRefusedError('refused: agent_blocked'));

    await expect(deliverForkSeed(conv, 'the kickoff', 'test')).rejects.toBeInstanceOf(ForkDeliveryRefusedError);

    expect(readHeldKickoff('refused')).toBe('the kickoff');
  });

  it('holds nothing when the failure is not a refusal', async () => {
    const conv = seedConversation('failed');
    vi.spyOn(forksModule, 'injectForkSummary').mockRejectedValue(new Error('herdr call timed out'));

    await expect(deliverForkSeed(conv, 'the kickoff', 'test')).rejects.toThrow('herdr call timed out');

    expect(readHeldKickoff('failed')).toBeNull();
  });

  it('holds nothing when the turn was typed but stranded', async () => {
    const conv = seedConversation('stranded');
    vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('stranded');

    await deliverForkSeed(conv, 'the kickoff', 'test');

    expect(readHeldKickoff('stranded')).toBeNull();
  });

  it('keeps a kickoff that is already held', async () => {
    const conv = seedConversation('held');
    holdKickoff('held', 'the first kickoff');
    vi.spyOn(forksModule, 'injectForkSummary').mockRejectedValue(new ForkDeliveryRefusedError('refused: agent_blocked'));

    await expect(deliverForkSeed(conv, 'a second kickoff', 'test')).rejects.toBeInstanceOf(ForkDeliveryRefusedError);

    expect(readHeldKickoff('held')).toBe('the first kickoff');
  });
});
