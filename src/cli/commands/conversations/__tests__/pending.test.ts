/** PAN-4641 WI-9: pan conv pending lists undelivered queued messages in id order. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doorMocks = vi.hoisted(() => ({ listScheduledMessages: vi.fn() }));
const exitMocks = vi.hoisted(() => ({ exitCli: vi.fn(async (_code: number) => undefined as never) }));

vi.mock('../../../agent-target.js', () => ({
  resolveCliSingleAgentId: async (input: string) => ({ ok: true, agentId: input }),
  printAgentTargetFailure: vi.fn(),
}));
vi.mock('../../../exit.js', () => ({ exitCli: exitMocks.exitCli }));
vi.mock('../../../../lib/overdeck/conversation-scheduled-messages.js', () => doorMocks);

function row(id: number, text: string, extra: Record<string, unknown> = {}) {
  return {
    id, conversationName: 'x', text, status: 'pending', notBefore: '2026-09-02T13:01:00.000Z',
    resetSource: 'quota-limits', limitWindow: 'five_hour', attempts: 0, lastError: null,
    createdAt: '2026-09-02T09:00:00.000Z', updatedAt: '2026-09-02T09:00:00.000Z', sentAt: null, deliveredAt: null,
    ...extra,
  };
}

describe('pan conv pending (PAN-4641)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const lines = (): string[] => logSpy.mock.calls.map((call) => String(call[0]));

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints one line per row in id order, with the last error', async () => {
    doorMocks.listScheduledMessages.mockReturnValue([
      row(3, 'first line\nsecond line'),
      row(7, 'x'.repeat(80), { status: 'failed', lastError: 'Session has ended' }),
    ]);
    const { pendingAction } = await import('../pending.js');

    await pendingAction('conv-x', {});

    expect(doorMocks.listScheduledMessages).toHaveBeenCalledWith('x');
    const printed = lines();
    expect(printed[0]).toMatch(/^#3 {2}pending {2}.+ {2}first line⏎second line$/);
    expect(printed[1]).toMatch(/^#7 {2}failed {2}/);
    expect(printed[1]).toContain(`${'x'.repeat(60)}…`);
    expect(printed[2]).toContain('last error: Session has ended');
  });

  it('says so when nothing is queued', async () => {
    doorMocks.listScheduledMessages.mockReturnValue([]);
    const { pendingAction } = await import('../pending.js');

    await pendingAction('conv-x', {});

    expect(lines()).toEqual(['No queued messages for conv-x.']);
  });

  it('prints parseable JSON with --json', async () => {
    doorMocks.listScheduledMessages.mockReturnValue([row(3, 'hello')]);
    const { pendingAction } = await import('../pending.js');

    await pendingAction('conv-x', { json: true });

    expect(JSON.parse(lines()[0]!)).toEqual([expect.objectContaining({ id: 3, text: 'hello' })]);
  });

  it('refuses a non-conversation target with exit 1', async () => {
    const { pendingAction } = await import('../pending.js');

    await pendingAction('agent-pan-1', {});

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(doorMocks.listScheduledMessages).not.toHaveBeenCalled();
  });
});
