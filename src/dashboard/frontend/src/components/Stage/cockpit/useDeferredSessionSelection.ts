import { useEffect, useState } from 'react';
import type { SessionNode } from '@overdeck/contracts';

export function useDeferredSessionSelection(
  sessions: readonly SessionNode[],
  onSelectSession: (session: SessionNode) => void,
) {
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingSessionId) return;
    const session = sessions.find((candidate) => candidate.sessionId === pendingSessionId);
    if (!session) return;
    onSelectSession(session);
    setPendingSessionId(null);
  }, [onSelectSession, pendingSessionId, sessions]);

  return setPendingSessionId;
}
