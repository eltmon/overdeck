/**
 * PAN-4640 WI-5: the conversation schedule sweep. Every collaborator is
 * injected or mocked — no SQLite, no terminal backend — so fake timers gate
 * nothing but the service's own boot delay and interval.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '../../http-helpers.js';
import type { DueSchedule } from '../../../../lib/overdeck/conversation-schedules.js';

const mocks = vi.hoisted(() => ({
  getConversationByName: vi.fn(),
  conversationHarnessAlive: vi.fn(),
  handleConversationResume: vi.fn(),
  handleConversationMessage: vi.fn(),
}));

vi.mock('../../../../lib/overdeck/conversations.js', () => ({
  getConversationByName: mocks.getConversationByName,
  getConversationById: vi.fn(() => null),
}));
vi.mock('../../../../lib/overdeck/conversation-liveness.js', () => ({
  conversationHarnessAlive: mocks.conversationHarnessAlive,
}));
vi.mock('../../../../lib/overdeck/conversation-runtime.js', () => ({
  handleConversationResume: mocks.handleConversationResume,
}));
vi.mock('../../../../lib/overdeck/conversation-message.js', () => ({
  handleConversationMessage: mocks.handleConversationMessage,
}));
vi.mock('../../../../lib/overdeck/conversation-reads.js', () => ({
  resolveSessionFile: vi.fn(async () => null),
}));
vi.mock('../../../../lib/overdeck/conversation-schedules.js', () => ({
  listDueSchedules: vi.fn(() => []),
  claimScheduleRun: vi.fn(() => false),
  recordScheduleRunOutcome: vi.fn(),
}));

const {
  fireScheduledPrompt,
  runScheduleSweepOnce,
  scheduledPromptText,
  startConversationScheduleService,
  stopConversationScheduleService,
  __setScheduleSweepForTests,
} = await import('../conversation-schedule-service.js');
const { nextRunAfter } = await import('../../../../lib/overdeck/conversation-schedule-recurrence.js');

const NOW = Date.parse('2026-11-01T21:00:30.000Z');

function due(overrides: Partial<DueSchedule> = {}): DueSchedule {
  return {
    id: 7,
    conversationName: 'conv-a',
    prompt: 'Summarize the day',
    cron: '0 21 * * *',
    timeZone: 'UTC',
    nextRunAt: Date.parse('2026-11-01T21:00:00.000Z'),
    archived: false,
    ...overrides,
  };
}

function sweepDeps(schedules: DueSchedule[], fire = vi.fn(async () => ({ ok: true as const }))) {
  return {
    now: () => NOW,
    listDue: vi.fn(() => schedules),
    claim: vi.fn(() => true),
    record: vi.fn(),
    nextRunAfter: vi.fn(nextRunAfter),
    fire,
  };
}

function conversation(overrides: Record<string, unknown> = {}) {
  return { id: 1, name: 'conv-a', tmuxSession: 'conv-a', harness: 'claude-code', clearedToConvId: null, archivedAt: null, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const mock of Object.values(mocks)) mock.mockReset();
});

afterEach(() => {
  stopConversationScheduleService();
  __setScheduleSweepForTests(null);
  vi.useRealTimers();
});

describe('runScheduleSweepOnce', () => {
  it('fires a due schedule and advances it', async () => {
    const deps = sweepDeps([due()]);
    const result = await runScheduleSweepOnce(deps);

    const expectedNext = Date.parse('2026-11-02T21:00:00.000Z');
    expect(deps.claim).toHaveBeenCalledWith(7, due().nextRunAt, expectedNext, NOW);
    expect(deps.fire).toHaveBeenCalledTimes(1);
    expect(deps.record).toHaveBeenCalledWith(7, 'delivered', null);
    expect(result).toEqual({ fired: 1, failed: 0, skipped: 0 });
  });

  it('collapses missed runs into one fire and claims the first occurrence after now', async () => {
    const stale = due({ nextRunAt: Date.parse('2026-10-29T21:00:00.000Z') });
    const deps = sweepDeps([stale]);
    await runScheduleSweepOnce(deps);

    expect(deps.fire).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith(7, stale.nextRunAt, Date.parse('2026-11-02T21:00:00.000Z'), NOW);
  });

  it('never fires when the claim is lost', async () => {
    const deps = sweepDeps([due()]);
    deps.claim.mockReturnValue(false);
    const result = await runScheduleSweepOnce(deps);

    expect(deps.fire).not.toHaveBeenCalled();
    expect(deps.record).not.toHaveBeenCalled();
    expect(result).toEqual({ fired: 0, failed: 0, skipped: 0 });
  });

  it('records an archived conversation as skipped without firing', async () => {
    const deps = sweepDeps([due({ archived: true })]);
    const result = await runScheduleSweepOnce(deps);

    expect(deps.claim).toHaveBeenCalled();
    expect(deps.fire).not.toHaveBeenCalled();
    expect(deps.record).toHaveBeenCalledWith(7, 'skipped', 'conversation archived');
    expect(result.skipped).toBe(1);
  });

  it('records a failure and does not retry before the next occurrence', async () => {
    const error = 'Waiting: the agent needs a permission answer first';
    const fire = vi.fn(async () => ({ ok: false as const, error }));
    const deps = sweepDeps([due()], fire);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runScheduleSweepOnce(deps);
    expect(deps.record).toHaveBeenCalledWith(7, 'failed', error);

    deps.listDue.mockReturnValue([]);
    await runScheduleSweepOnce(deps);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('turns a thrown fire into a recorded failure', async () => {
    const fire = vi.fn(async () => {
      throw new Error('boom');
    });
    const deps = sweepDeps([due()], fire);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runScheduleSweepOnce(deps);
    expect(deps.record).toHaveBeenCalledWith(7, 'failed', 'boom');
    expect(result.failed).toBe(1);
  });
});

describe('fireScheduledPrompt', () => {
  it('resumes an ended session with cause message, then delivers the prompt', async () => {
    mocks.getConversationByName.mockReturnValue(conversation());
    mocks.conversationHarnessAlive.mockResolvedValue(false);
    mocks.handleConversationResume.mockResolvedValue(jsonResponse({ status: 'active' }));
    mocks.handleConversationMessage.mockResolvedValue(jsonResponse({ ok: true }));

    expect(await fireScheduledPrompt(due())).toEqual({ ok: true });

    expect(mocks.handleConversationResume).toHaveBeenCalledWith('conv-a', {}, expect.objectContaining({ resumeCause: 'message' }));
    expect(mocks.handleConversationResume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.handleConversationMessage.mock.invocationCallOrder[0]!,
    );
    const body = mocks.handleConversationMessage.mock.calls[0]![1] as Record<string, unknown>;
    expect(String(body['message']).startsWith('[Scheduled run · schedule ')).toBe(true);
    expect(body['message']).toBe(scheduledPromptText(due()));
    expect(body).not.toHaveProperty('deliverAs');
  });

  it('does not resume a live session', async () => {
    mocks.getConversationByName.mockReturnValue(conversation());
    mocks.conversationHarnessAlive.mockResolvedValue(true);
    mocks.handleConversationMessage.mockResolvedValue(jsonResponse({ ok: true }));

    expect(await fireScheduledPrompt(due())).toEqual({ ok: true });
    expect(mocks.handleConversationResume).not.toHaveBeenCalled();
  });

  it('delivers to Pi conversations as follow_up', async () => {
    mocks.getConversationByName.mockReturnValue(conversation({ harness: 'pi' }));
    mocks.conversationHarnessAlive.mockResolvedValue(true);
    mocks.handleConversationMessage.mockResolvedValue(jsonResponse({ ok: true }));

    await fireScheduledPrompt(due());
    expect(mocks.handleConversationMessage.mock.calls[0]![1]).toMatchObject({ deliverAs: 'follow_up' });
  });

  it('reports resume and delivery errors from the response body', async () => {
    mocks.getConversationByName.mockReturnValue(conversation());
    mocks.conversationHarnessAlive.mockResolvedValue(false);
    mocks.handleConversationResume.mockResolvedValue(jsonResponse({ error: 'Invalid cwd' }, { status: 400 }));
    expect(await fireScheduledPrompt(due())).toEqual({ ok: false, error: 'resume failed: Invalid cwd' });

    mocks.conversationHarnessAlive.mockResolvedValue(true);
    mocks.handleConversationMessage.mockResolvedValue(jsonResponse({ error: 'permission pending', code: 'permission-pending' }, { status: 409 }));
    expect(await fireScheduledPrompt(due())).toEqual({ ok: false, error: 'permission pending' });
  });

  it('fails for a missing conversation and a broken clear chain', async () => {
    mocks.getConversationByName.mockReturnValue(null);
    expect(await fireScheduledPrompt(due())).toEqual({ ok: false, error: 'conversation not found' });

    mocks.getConversationByName.mockReturnValue(conversation({ clearedToConvId: 2 }));
    expect(await fireScheduledPrompt(due())).toEqual({
      ok: false,
      error: 'conversation was cleared and its continuation is unavailable',
    });
  });
});

describe('service timers', () => {
  it('sweeps at boot +30 s, then every 60 s, and stops', async () => {
    const sweep = vi.fn(async () => ({ fired: 0, failed: 0, skipped: 0 }));
    __setScheduleSweepForTests(sweep);
    startConversationScheduleService();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(sweep).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);

    stopConversationScheduleService();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('never overlaps a sweep that is still running', async () => {
    let release: () => void = () => {};
    const sweep = vi.fn(() => new Promise<{ fired: number; failed: number; skipped: number }>((resolve) => {
      release = () => resolve({ fired: 0, failed: 0, skipped: 0 });
    }));
    __setScheduleSweepForTests(sweep);
    startConversationScheduleService();

    await vi.advanceTimersByTimeAsync(30_000 + 60_000 * 2);
    expect(sweep).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
