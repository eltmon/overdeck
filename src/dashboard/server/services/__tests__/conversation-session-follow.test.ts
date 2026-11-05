/** PAN-2652 W6: a live conversation stream follows the conversation's current Claude session. */
import { Effect, Fiber, Stream } from 'effect';
import { describe, expect, it, vi } from 'vitest';

const listeners = vi.hoisted(() => ({ live: 0 }));

vi.mock('../../../../lib/overdeck/conversation-session-events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/overdeck/conversation-session-events.js')>();
  return {
    ...actual,
    onConversationSessionChanged: (name: string, listener: (sessionId: string) => void) => {
      listeners.live++;
      const off = actual.onConversationSessionChanged(name, listener);
      return () => {
        listeners.live--;
        off();
      };
    },
  };
});

const { notifyConversationSessionChanged } = await import('../../../../lib/overdeck/conversation-session-events.js');
const { followConversationSession } = await import('../conversation-session-follow.js');

describe('followConversationSession (PAN-2652 W6)', () => {
  it('ac1: a session change re-opens with switched=true and interrupts the previous inner stream', async () => {
    const opened: boolean[] = [];
    const ended: boolean[] = [];
    const seen: string[] = [];
    const open = (switched: boolean) => {
      opened.push(switched);
      return Stream.concat(Stream.make(switched ? 'switched' : 'initial'), Stream.never).pipe(
        Stream.ensuring(Effect.sync(() => { ended.push(switched); })),
      );
    };
    const fiber = Effect.runFork(
      followConversationSession('conv-follow', open).pipe(
        Stream.tap((event) => Effect.sync(() => { seen.push(event); })),
        Stream.runDrain,
      ),
    );
    await vi.waitFor(() => expect(seen).toEqual(['initial']));

    notifyConversationSessionChanged('conv-follow', 'b');
    await vi.waitFor(() => expect(seen).toEqual(['initial', 'switched']));
    expect(opened).toEqual([false, true]);
    expect(ended).toEqual([false]);

    notifyConversationSessionChanged('conv-follow', 'c');
    await vi.waitFor(() => expect(opened).toEqual([false, true, true]));
    await vi.waitFor(() => expect(ended).toEqual([false, true]));
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it('ac2: interrupting the stream removes its session-changed listener', async () => {
    const before = listeners.live;
    let opened = false;
    const fiber = Effect.runFork(
      followConversationSession('conv-follow-2', () => {
        opened = true;
        return Stream.never;
      }).pipe(Stream.runDrain),
    );
    await vi.waitFor(() => expect(opened).toBe(true));
    expect(listeners.live).toBe(before + 1);
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(listeners.live).toBe(before);
  });

  it('ignores session changes for another conversation', async () => {
    const opened: boolean[] = [];
    const fiber = Effect.runFork(
      followConversationSession('conv-follow-3', (switched) => {
        opened.push(switched);
        return Stream.make('initial');
      }).pipe(Stream.runDrain),
    );
    await vi.waitFor(() => expect(opened).toEqual([false]));
    notifyConversationSessionChanged('conv-other', 'b');
    notifyConversationSessionChanged('conv-follow-3', 'c');
    await vi.waitFor(() => expect(opened).toEqual([false, true]));
    await Effect.runPromise(Fiber.interrupt(fiber));
  });
});
