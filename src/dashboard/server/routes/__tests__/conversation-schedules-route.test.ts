/** PAN-4640 WI-3: GET/POST /api/conversations/:name/schedules and PATCH/DELETE …/:id. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

let testHome: string;
let originalHome: string | undefined;

// PAN-4657 WI-4: spy on the door's emitter without mocking the rest of the
// module (createConversationSchedule et al. still run for real).
const emitConversationSchedulesChangedMock = vi.fn();
vi.mock('../../../../lib/overdeck/conversation-schedules.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/overdeck/conversation-schedules.js')>()),
  emitConversationSchedulesChanged: emitConversationSchedulesChangedMock,
}));

function decode(response: { body: unknown }): unknown {
  const payload = response.body as { body: Uint8Array } | null;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return text ? JSON.parse(text) : null;
}

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const { conversationSchedulesRouteLayer } = await import('../conversation-schedules.js');
  const req = HttpServerRequest.fromWeb(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Origin: 'http://localhost:3011', 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(conversationSchedulesRouteLayer), (app) =>
        Effect.provideService(app, HttpServerRequest.HttpServerRequest, req),
      ),
    ),
  );
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4640-schedules-route-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  emitConversationSchedulesChangedMock.mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function seedConversation(name: string) {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: testHome, harness: 'claude-code' });
}

const DAILY = { prompt: 'Summarize the day', cron: '0 21 * * *', timeZone: 'America/New_York' };

describe('schedule routes (PAN-4640 WI-3)', () => {
  it('POST creates (201) and GET lists it', async () => {
    await seedConversation('conv-a');
    const created = await request('POST', '/api/conversations/conv-a/schedules', DAILY);
    expect(created.status).toBe(201);
    expect(decode(created)).toMatchObject({ schedule: { conversationName: 'conv-a', cron: '0 21 * * *', enabled: true } });
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledTimes(1);
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledWith('conv-a');

    const listed = await request('GET', '/api/conversations/conv-a/schedules');
    expect(listed.status).toBe(200);
    expect(decode(listed)).toMatchObject({ schedules: [{ prompt: 'Summarize the day', timeZone: 'America/New_York' }] });
  });

  it('POST rejects a too-frequent cron with 400 and the spacing message, and emits nothing', async () => {
    await seedConversation('conv-b');
    const response = await request('POST', '/api/conversations/conv-b/schedules', { ...DAILY, cron: '* * * * *' });
    expect(response.status).toBe(400);
    expect(decode(response)).toEqual({ error: 'Schedules must be at least 15 minutes apart' });
    expect(emitConversationSchedulesChangedMock).not.toHaveBeenCalled();
  });

  it('POST on an agent conversation returns 409 agent-conversation; unknown returns 404', async () => {
    await seedConversation('agent-pan-1-work');
    const refused = await request('POST', '/api/conversations/agent-pan-1-work/schedules', DAILY);
    expect(refused.status).toBe(409);
    expect(decode(refused)).toMatchObject({ code: 'agent-conversation' });

    const missing = await request('POST', '/api/conversations/no-such/schedules', DAILY);
    expect(missing.status).toBe(404);
    expect((await request('GET', '/api/conversations/no-such/schedules')).status).toBe(404);
  });

  it('PATCH { enabled: false } pauses the schedule; bad ids and invalid cron are 400', async () => {
    await seedConversation('conv-c');
    const created = decode(await request('POST', '/api/conversations/conv-c/schedules', DAILY)) as { schedule: { id: number } };
    const id = created.schedule.id;

    emitConversationSchedulesChangedMock.mockClear();
    const paused = await request('PATCH', `/api/conversations/conv-c/schedules/${id}`, { enabled: false });
    expect(paused.status).toBe(200);
    expect(decode(paused)).toMatchObject({ schedule: { id, enabled: false } });
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledTimes(1);
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledWith('conv-c');

    expect((await request('PATCH', '/api/conversations/conv-c/schedules/abc', { enabled: true })).status).toBe(400);
    const invalid = await request('PATCH', `/api/conversations/conv-c/schedules/${id}`, { cron: '*/5 * * * *' });
    expect(invalid.status).toBe(400);
    expect(decode(invalid)).toEqual({ error: 'Schedules must be at least 15 minutes apart' });
    const missing = await request('PATCH', '/api/conversations/conv-c/schedules/9999', { enabled: true });
    expect(missing.status).toBe(404);
    expect(decode(missing)).toEqual({ error: 'Schedule not found' });
  });

  it('DELETE returns 200 then 404, emitting only for the 200', async () => {
    await seedConversation('conv-d');
    const created = decode(await request('POST', '/api/conversations/conv-d/schedules', DAILY)) as { schedule: { id: number } };
    const path = `/api/conversations/conv-d/schedules/${created.schedule.id}`;

    emitConversationSchedulesChangedMock.mockClear();
    const first = await request('DELETE', path);
    expect(first.status).toBe(200);
    expect(decode(first)).toEqual({ removed: true });
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledTimes(1);
    expect(emitConversationSchedulesChangedMock).toHaveBeenCalledWith('conv-d');

    emitConversationSchedulesChangedMock.mockClear();
    const second = await request('DELETE', path);
    expect(second.status).toBe(404);
    expect(decode(second)).toEqual({ error: 'Schedule not found' });
    expect(emitConversationSchedulesChangedMock).not.toHaveBeenCalled();
  });
});
