import type { SessionNode } from '@overdeck/contracts';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDeferredSessionSelection } from './useDeferredSessionSelection';

const session = { sessionId: 'agent-pan-3356-review-security' } as SessionNode;

describe('useDeferredSessionSelection', () => {
  it('selects a queued session when it appears', () => {
    const onSelectSession = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessions }) => useDeferredSessionSelection(sessions, onSelectSession),
      { initialProps: { sessions: [] as readonly SessionNode[] } },
    );

    act(() => result.current.queue(session.sessionId));
    rerender({ sessions: [session] });

    expect(onSelectSession).toHaveBeenCalledWith(session);
  });

  it('does not apply a queued session after explicit navigation cancels it', () => {
    const onSelectSession = vi.fn();
    const { result, rerender } = renderHook(
      ({ sessions }) => useDeferredSessionSelection(sessions, onSelectSession),
      { initialProps: { sessions: [] as readonly SessionNode[] } },
    );

    act(() => result.current.queue(session.sessionId));
    act(() => result.current.cancel());
    rerender({ sessions: [session] });

    expect(onSelectSession).not.toHaveBeenCalled();
  });
});
