/**
 * `pan conv schedule add` / `list` / `pause` / `resume` / `rm` (PAN-4640).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../../tests/helpers/overdeck-test-db.js';

vi.mock('chalk', () => {
  const identity = (s: unknown) => String(s);
  const chalk = new Proxy(identity, {
    get: () => new Proxy(identity, { get: () => identity }),
  });
  return { default: chalk };
});

vi.mock('../../../../lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../../lib/config.js')>()),
  getDashboardApiUrl: vi.fn(() => 'http://dashboard.test'),
}));

const currentMock = vi.fn();
vi.mock('../../../../lib/conversations/current.js', () => ({
  resolveCurrentConversation: (...args: unknown[]) => currentMock(...args),
}));

const DAILY_SCHEDULE = {
  id: 3,
  conversationName: 'sched-conv',
  conversationTitle: 'Schedule conversation',
  prompt: 'hi',
  cron: '0 21 * * *',
  timeZone: 'America/New_York',
  enabled: true,
  nextRunAt: '2026-11-02T02:00:00.000Z',
  lastRunAt: null,
  lastRunStatus: null,
  lastRunError: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  updatedAt: '2026-11-01T12:00:00.000Z',
};

let odb: OverdeckTestDb;

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  process.env.HOME = odb.home;
  currentMock.mockReset();
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name: 'sched-conv', tmuxSession: 'tmux-sched-conv', cwd: '/tmp/sched-conv', title: 'Schedule conversation', harness: 'claude-code' });
});

afterEach(() => {
  delete process.env.HOME;
  teardownOverdeckTestDb(odb);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((msg) => logs.push(String(msg ?? '')));
  vi.spyOn(console, 'error').mockImplementation((msg) => errors.push(String(msg ?? '')));
  return { logs, errors };
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const connRefused = () => new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
});

async function seedSchedule(): Promise<number> {
  const { createConversationSchedule } = await import('../../../../lib/overdeck/conversation-schedules.js');
  const result = createConversationSchedule('sched-conv', { prompt: 'hi', cron: '0 21 * * *', timeZone: 'America/New_York', enabled: true });
  if (result.status !== 'created') throw new Error('seed failed');
  return result.schedule.id;
}

describe('scheduleAddAction', () => {
  it('resolves self and POSTs the compiled preset to the dashboard', async () => {
    currentMock.mockResolvedValue({ name: 'sched-conv' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schedule: DAILY_SCHEDULE }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { scheduleAddAction } = await import('../schedule.js');
    const { logs } = captureConsole();

    await scheduleAddAction('self', { daily: '21:00', prompt: 'hi', tz: 'America/New_York' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://dashboard.test/api/conversations/sched-conv/schedules');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ cron: '0 21 * * *', timeZone: 'America/New_York', prompt: 'hi', enabled: true });
    expect(logs.join('\n')).toContain('✓ Schedule 3 on sched-conv: 0 21 * * * (America/New_York) — next run 2026-11-01 21:00 EST');
  });

  it('reads the prompt from --prompt-file and resolves a title match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pan-4640-prompt-'));
    const file = join(dir, 'prompt.md');
    writeFileSync(file, 'From a file');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schedule: DAILY_SCHEDULE }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const { scheduleAddAction } = await import('../schedule.js');
    captureConsole();

    try {
      await scheduleAddAction('Schedule conversation', { weekly: 'mon 09:00', promptFile: file, tz: 'UTC' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      cron: '0 9 * * 1', timeZone: 'UTC', prompt: 'From a file', enabled: true,
    });
  });

  it('exits 1 when more than one recurrence option is passed', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { scheduleAddAction } = await import('../schedule.js');
    const { errors } = captureConsole();
    mockExit();

    await expect(scheduleAddAction('sched-conv', { cron: '0 21 * * *', hourly: true, prompt: 'hi' })).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('Pass exactly one of --cron, --hourly, --daily, --weekdays, --weekly');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exits 1 with the API message on a 400 and 2 when self cannot be resolved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Schedules must be at least 15 minutes apart' }, 400)));
    const { scheduleAddAction } = await import('../schedule.js');
    const { errors } = captureConsole();
    mockExit();

    await expect(scheduleAddAction('sched-conv', { cron: '* * * * *', prompt: 'hi', tz: 'UTC' })).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('Schedules must be at least 15 minutes apart');

    currentMock.mockResolvedValue(null);
    await expect(scheduleAddAction('self', { hourly: true, prompt: 'hi' })).rejects.toThrow('exit 2');
    expect(errors.join('\n')).toContain('Not running inside an Overdeck conversation');
  });

  it('writes through the door when the dashboard is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connRefused()));
    const { scheduleAddAction } = await import('../schedule.js');
    const { logs } = captureConsole();

    await scheduleAddAction('sched-conv', { cron: '0 21 * * *', prompt: 'offline', tz: 'America/New_York' });

    const { listConversationSchedules } = await import('../../../../lib/overdeck/conversation-schedules.js');
    expect(listConversationSchedules('sched-conv')).toMatchObject([{ prompt: 'offline', cron: '0 21 * * *' }]);
    expect(logs.join('\n')).toContain('on sched-conv: 0 21 * * * (America/New_York)');
  });

  it('maps an offline validation error to exit 1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connRefused()));
    const { scheduleAddAction } = await import('../schedule.js');
    const { errors } = captureConsole();
    mockExit();

    await expect(scheduleAddAction('sched-conv', { cron: '*/5 * * * *', prompt: 'hi', tz: 'UTC' })).rejects.toThrow('exit 1');
    expect(errors.join('\n')).toContain('Schedules must be at least 15 minutes apart');
  });
});

describe('scheduleListAction', () => {
  it('prints the next run in the schedule zone', async () => {
    await seedSchedule();
    const { scheduleListAction } = await import('../schedule.js');
    const { logs } = captureConsole();

    await scheduleListAction(undefined);

    const output = logs.join('\n');
    expect(output).toContain('sched-conv  0 21 * * *  America/New_York  next ');
    expect(output).toMatch(/21:00 E[SD]T {2}last — {2}enabled/);
  });

  it('prints No schedules and JSON', async () => {
    const { scheduleListAction } = await import('../schedule.js');
    const { logs } = captureConsole();

    await scheduleListAction('sched-conv');
    expect(logs).toContain('No schedules');

    await seedSchedule();
    await scheduleListAction('sched-conv', { json: true });
    expect(JSON.parse(logs[logs.length - 1]!)).toMatchObject([{ conversationName: 'sched-conv', cron: '0 21 * * *' }]);
  });
});

describe('pause / resume / rm', () => {
  it('pause PATCHes enabled false to the schedule conversation', async () => {
    const id = await seedSchedule();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ schedule: { ...DAILY_SCHEDULE, id, enabled: false } }));
    vi.stubGlobal('fetch', fetchMock);
    const { scheduleSetEnabledAction } = await import('../schedule.js');
    const { logs } = captureConsole();

    await scheduleSetEnabledAction(String(id), false);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://dashboard.test/api/conversations/sched-conv/schedules/${id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
    expect(logs.join('\n')).toContain(`✓ Paused schedule ${id} on sched-conv`);
  });

  it('resume and rm fall back to the door when the dashboard is down', async () => {
    const id = await seedSchedule();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(connRefused()));
    const { scheduleSetEnabledAction, scheduleRemoveAction } = await import('../schedule.js');
    const { getConversationSchedule } = await import('../../../../lib/overdeck/conversation-schedules.js');
    captureConsole();

    await scheduleSetEnabledAction(String(id), false);
    expect(getConversationSchedule(id)?.enabled).toBe(false);
    await scheduleSetEnabledAction(String(id), true);
    expect(getConversationSchedule(id)?.enabled).toBe(true);
    await scheduleRemoveAction(String(id));
    expect(getConversationSchedule(id)).toBeNull();
  });

  it('exits 2 for an unknown schedule and 1 for a non-numeric id', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { scheduleRemoveAction } = await import('../schedule.js');
    const { errors } = captureConsole();
    mockExit();

    await expect(scheduleRemoveAction('999')).rejects.toThrow('exit 2');
    expect(errors.join('\n')).toContain('Schedule 999 not found');
    await expect(scheduleRemoveAction('abc')).rejects.toThrow('exit 1');
  });
});
