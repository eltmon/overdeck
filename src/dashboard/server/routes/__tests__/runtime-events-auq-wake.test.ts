import { Effect, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../services/needs-you-push-service.js', () => ({ wakeNeedsYouPush: vi.fn() }));

const { wakeNeedsYouPush } = await import('../../services/needs-you-push-service.js');
const { emitAgentRuntimeEvent } = await import('../agents/runtime-events.js');
const { AgentStateService } = await import('../../services/agent-state-service.js');

const TS = '2026-11-01T00:00:00.000Z';

function agentStateService(emitted: unknown[]) {
  const snapshot = { id: 'conv-x', activity: 'idle' as const, lastActivity: TS, updatedAtSequence: 1 };
  return {
    get: () => Effect.succeed(snapshot),
    getAll: Effect.succeed({ 'conv-x': snapshot }),
    changes: Stream.empty,
    emit: (event: unknown) => Effect.sync(() => { emitted.push(event); }),
  };
}

function run(body: Record<string, unknown>) {
  const emitted: unknown[] = [];
  return Effect.runPromise(
    emitAgentRuntimeEvent('conv-x', body, TS).pipe(
      Effect.provideService(AgentStateService, agentStateService(emitted) as never),
    ),
  ).then(result => ({ result, emitted }));
}

describe('heartbeat ask_user_question_blocked wakes needs-you push (PAN-2354)', () => {
  it('wakes the push service once and emits no domain event', async () => {
    vi.mocked(wakeNeedsYouPush).mockClear();
    const { result, emitted } = await run({ kind: 'ask_user_question_blocked', timestamp: TS, questions: [] });
    expect(wakeNeedsYouPush).toHaveBeenCalledTimes(1);
    expect(wakeNeedsYouPush).toHaveBeenCalledWith('auq-hook:conv-x');
    expect(result).toEqual({ ok: true, emitted: false });
    expect(emitted).toEqual([]);
  });

  it('does not wake for an ordinary activity heartbeat', async () => {
    vi.mocked(wakeNeedsYouPush).mockClear();
    const { result } = await run({ kind: 'activity', activity: 'idle' });
    expect(wakeNeedsYouPush).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, emitted: true });
  });
});
