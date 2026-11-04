/** PAN-4640 WI-2: the conversation schedules door. Explicit `now` values; no timers. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const DAILY = { prompt: 'Summarize the day', cron: '0 21 * * *', timeZone: 'America/New_York', enabled: true };

const emitOnlyMock = vi.fn();
const getEventStoreMock = vi.fn(() => ({ emitOnly: emitOnlyMock }));
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: getEventStoreMock,
}));

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4640-schedules-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  emitOnlyMock.mockClear();
  getEventStoreMock.mockReset();
  getEventStoreMock.mockImplementation(() => ({ emitOnly: emitOnlyMock }));
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function makeConversation(name: string): Promise<void> {
  const { createConversation } = await import('../conversations.js');
  createConversation({ name, tmuxSession: name, cwd: testHome, harness: 'claude-code' });
}

describe('conversation schedules store', () => {
  it('creates a schedule with nextRunAt from nextRunAfter and lists it', async () => {
    await makeConversation('conv-a');
    const { createConversationSchedule, listConversationSchedules, listAllConversationSchedules, getConversationSchedule } =
      await import('../conversation-schedules.js');
    const { nextRunAfter } = await import('../conversation-schedule-recurrence.js');

    const result = createConversationSchedule('conv-a', DAILY, NOW);
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    const expected = nextRunAfter(DAILY.cron, DAILY.timeZone, new Date(NOW))!.toISOString();
    expect(result.schedule).toMatchObject({
      conversationName: 'conv-a',
      prompt: 'Summarize the day',
      cron: '0 21 * * *',
      timeZone: 'America/New_York',
      enabled: true,
      nextRunAt: expected,
      lastRunAt: null,
      lastRunStatus: null,
    });

    expect(listConversationSchedules('conv-a')).toEqual([result.schedule]);
    expect(listAllConversationSchedules()).toEqual([result.schedule]);
    expect(getConversationSchedule(result.schedule.id)).toEqual(result.schedule);
  });

  it('stores a null next run for a schedule created paused', async () => {
    await makeConversation('conv-paused');
    const { createConversationSchedule } = await import('../conversation-schedules.js');
    const result = createConversationSchedule('conv-paused', { ...DAILY, enabled: false }, NOW);
    expect(result).toMatchObject({ status: 'created', schedule: { enabled: false, nextRunAt: null } });
  });

  it('refuses agent conversations and vault copies, and reports unknown names', async () => {
    await makeConversation('agent-pan-1-work');
    await makeConversation('browse-copy-abc');
    const { getOverdeckDatabase } = await import('../infra.js');
    getOverdeckDatabase().prepare("UPDATE conversations SET origin = 'vault' WHERE name = ?").run('browse-copy-abc');
    const { createConversationSchedule } = await import('../conversation-schedules.js');

    expect(createConversationSchedule('agent-pan-1-work', DAILY, NOW)).toMatchObject({ status: 'refused', code: 'agent-conversation' });
    expect(createConversationSchedule('browse-copy-abc', DAILY, NOW)).toMatchObject({ status: 'refused', code: 'vault-browse-copy' });
    expect(createConversationSchedule('no-such-conversation', DAILY, NOW)).toEqual({ status: 'not-found' });
  });

  it('returns limit for the 21st schedule', async () => {
    await makeConversation('conv-limit');
    const { createConversationSchedule, MAX_SCHEDULES_PER_CONVERSATION } = await import('../conversation-schedules.js');
    for (let i = 0; i < MAX_SCHEDULES_PER_CONVERSATION; i++) {
      expect(createConversationSchedule('conv-limit', DAILY, NOW).status).toBe('created');
    }
    expect(createConversationSchedule('conv-limit', DAILY, NOW)).toEqual({ status: 'limit' });
  });

  it('claims a run once for the stored next_run_at', async () => {
    await makeConversation('conv-claim');
    const { createConversationSchedule, claimScheduleRun, getConversationSchedule } = await import('../conversation-schedules.js');
    const created = createConversationSchedule('conv-claim', DAILY, NOW);
    if (created.status !== 'created') throw new Error('unreachable');
    const expected = Date.parse(created.schedule.nextRunAt!);
    const following = expected + 24 * 3_600_000;

    expect(claimScheduleRun(created.schedule.id, expected, following, expected + 1_000)).toBe(true);
    expect(claimScheduleRun(created.schedule.id, expected, following, expected + 2_000)).toBe(false);
    expect(getConversationSchedule(created.schedule.id)).toMatchObject({
      nextRunAt: new Date(following).toISOString(),
      lastRunAt: new Date(expected + 1_000).toISOString(),
      enabled: true,
    });
  });

  it('disables the schedule when a claim has no next run', async () => {
    await makeConversation('conv-final');
    const { createConversationSchedule, claimScheduleRun, getConversationSchedule } = await import('../conversation-schedules.js');
    const created = createConversationSchedule('conv-final', DAILY, NOW);
    if (created.status !== 'created') throw new Error('unreachable');
    expect(claimScheduleRun(created.schedule.id, Date.parse(created.schedule.nextRunAt!), null, NOW)).toBe(true);
    expect(getConversationSchedule(created.schedule.id)).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it('pause keeps next_run_at and resume recomputes it from the resume time', async () => {
    await makeConversation('conv-pause');
    const { createConversationSchedule, updateConversationSchedule } = await import('../conversation-schedules.js');
    const { nextRunAfter } = await import('../conversation-schedule-recurrence.js');
    const created = createConversationSchedule('conv-pause', DAILY, NOW);
    if (created.status !== 'created') throw new Error('unreachable');

    const paused = updateConversationSchedule('conv-pause', created.schedule.id, { enabled: false }, NOW + 1_000);
    expect(paused).toMatchObject({ enabled: false, nextRunAt: created.schedule.nextRunAt });

    const resumeAt = NOW + 3 * 24 * 3_600_000;
    const resumed = updateConversationSchedule('conv-pause', created.schedule.id, { enabled: true }, resumeAt);
    expect(resumed).toMatchObject({
      enabled: true,
      nextRunAt: nextRunAfter(DAILY.cron, DAILY.timeZone, new Date(resumeAt))!.toISOString(),
      updatedAt: new Date(resumeAt).toISOString(),
    });
  });

  it('a prompt-only edit keeps next_run_at; an invalid merged cron throws ScheduleValidationError', async () => {
    await makeConversation('conv-edit');
    const { createConversationSchedule, updateConversationSchedule, ScheduleValidationError } = await import('../conversation-schedules.js');
    const created = createConversationSchedule('conv-edit', DAILY, NOW);
    if (created.status !== 'created') throw new Error('unreachable');

    const edited = updateConversationSchedule('conv-edit', created.schedule.id, { prompt: 'New prompt' }, NOW + 5_000);
    expect(edited).toMatchObject({ prompt: 'New prompt', nextRunAt: created.schedule.nextRunAt });

    expect(() => updateConversationSchedule('conv-edit', created.schedule.id, { cron: '*/5 * * * *' }, NOW)).toThrow(ScheduleValidationError);
    expect(updateConversationSchedule('other-conversation', created.schedule.id, { prompt: 'x' }, NOW)).toBeNull();
  });

  it('listDueSchedules omits disabled rows and marks archived conversations', async () => {
    await makeConversation('conv-live');
    await makeConversation('conv-archived');
    const { createConversationSchedule, listDueSchedules } = await import('../conversation-schedules.js');
    const { archiveConversation } = await import('../conversations.js');
    const live = createConversationSchedule('conv-live', DAILY, NOW);
    const archived = createConversationSchedule('conv-archived', DAILY, NOW);
    createConversationSchedule('conv-live', { ...DAILY, enabled: false }, NOW);
    if (live.status !== 'created' || archived.status !== 'created') throw new Error('unreachable');
    archiveConversation('conv-archived');

    const due = listDueSchedules(NOW + 2 * 24 * 3_600_000);
    expect(due.map((d) => [d.id, d.conversationName, d.archived])).toEqual([
      [live.schedule.id, 'conv-live', false],
      [archived.schedule.id, 'conv-archived', true],
    ]);
    expect(listDueSchedules(NOW)).toEqual([]);
  });

  it('records a run outcome and truncates long errors', async () => {
    await makeConversation('conv-outcome');
    const { createConversationSchedule, recordScheduleRunOutcome, getConversationSchedule } = await import('../conversation-schedules.js');
    const created = createConversationSchedule('conv-outcome', DAILY, NOW);
    if (created.status !== 'created') throw new Error('unreachable');
    recordScheduleRunOutcome(created.schedule.id, 'failed', 'x'.repeat(800));
    const row = getConversationSchedule(created.schedule.id);
    expect(row?.lastRunStatus).toBe('failed');
    expect(row?.lastRunError).toHaveLength(500);
  });

  it('removes a schedule once, and deleting the conversation cascades', async () => {
    await makeConversation('conv-rm');
    const { createConversationSchedule, removeConversationSchedule, listConversationSchedules, getConversationSchedule } =
      await import('../conversation-schedules.js');
    const first = createConversationSchedule('conv-rm', DAILY, NOW);
    const second = createConversationSchedule('conv-rm', DAILY, NOW);
    if (first.status !== 'created' || second.status !== 'created') throw new Error('unreachable');

    expect(removeConversationSchedule('conv-rm', first.schedule.id)).toBe(true);
    expect(removeConversationSchedule('conv-rm', first.schedule.id)).toBe(false);
    expect(listConversationSchedules('conv-rm')).toHaveLength(1);

    const { getOverdeckDatabase } = await import('../infra.js');
    getOverdeckDatabase().prepare('DELETE FROM conversations WHERE name = ?').run('conv-rm');
    expect(getConversationSchedule(second.schedule.id)).toBeNull();
    const count = getOverdeckDatabase().prepare('SELECT COUNT(*) AS count FROM conversation_schedules').get<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe('schedule input validation', () => {
  it('validates create input with defaults', async () => {
    const { validateScheduleInput } = await import('../conversation-schedules.js');
    const { defaultScheduleTimeZone } = await import('../conversation-schedule-recurrence.js');
    expect(validateScheduleInput({ prompt: '  hi  ', cron: '0 21 * * *' }, NOW)).toEqual({
      ok: true,
      value: { prompt: 'hi', cron: '0 21 * * *', timeZone: defaultScheduleTimeZone(), enabled: true },
    });
    expect(validateScheduleInput({ prompt: '   ', cron: '0 21 * * *' }, NOW)).toEqual({ ok: false, error: 'prompt is required' });
    expect(validateScheduleInput({ prompt: 'x'.repeat(40_001), cron: '0 21 * * *' }, NOW).ok).toBe(false);
    expect(validateScheduleInput({ prompt: 'hi', cron: '* * * * *' }, NOW)).toEqual({
      ok: false,
      error: 'Schedules must be at least 15 minutes apart',
    });
    expect(validateScheduleInput({ prompt: 'hi', cron: '0 21 * * *', enabled: 'yes' }, NOW)).toEqual({
      ok: false,
      error: 'enabled must be a boolean',
    });
  });

  it('validates patch input', async () => {
    const { validateSchedulePatch } = await import('../conversation-schedules.js');
    expect(validateSchedulePatch({}, NOW).ok).toBe(false);
    expect(validateSchedulePatch({ enabled: false }, NOW)).toEqual({ ok: true, value: { enabled: false } });
    expect(validateSchedulePatch({ enabled: 1 }, NOW).ok).toBe(false);
    expect(validateSchedulePatch({ cron: '*/5 * * * *', timeZone: 'UTC' }, NOW)).toEqual({
      ok: false,
      error: 'Schedules must be at least 15 minutes apart',
    });
  });
});

describe('fresh database', () => {
  it('contains the conversation_schedules table', async () => {
    const { getOverdeckDatabase } = await import('../infra.js');
    const row = getOverdeckDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_schedules'")
      .get<{ name: string }>();
    expect(row?.name).toBe('conversation_schedules');
  });
});

describe('emitConversationSchedulesChanged', () => {
  it('emits through emitOnly with the conversation name', async () => {
    const { emitConversationSchedulesChanged } = await import('../conversation-schedules.js');
    emitConversationSchedulesChanged('conv-a');
    expect(emitOnlyMock).toHaveBeenCalledTimes(1);
    expect(emitOnlyMock.mock.calls[0]?.[0]).toMatchObject({
      type: 'conversation.schedules_changed',
      payload: { conversationName: 'conv-a' },
    });
  });

  it('does not throw when getEventStore throws', async () => {
    getEventStoreMock.mockImplementationOnce(() => {
      throw new Error('event store uninitialized');
    });
    const { emitConversationSchedulesChanged } = await import('../conversation-schedules.js');
    expect(() => emitConversationSchedulesChanged('conv-a')).not.toThrow();
    expect(emitOnlyMock).not.toHaveBeenCalled();
  });
});
