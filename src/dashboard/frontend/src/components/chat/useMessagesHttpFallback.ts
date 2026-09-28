/** PAN-4312: for streaming conversations HTTP /messages is a fallback, not a parallel load. */
import { useEffect, useState } from 'react';

export const MESSAGES_HTTP_FALLBACK_MS = 1500;

/** True once `delayMs` pass for this identity without a first stream payload; false again after one arrives. */
export function useMessagesHttpFallback(
  streamEnabled: boolean,
  receivedFirstPayload: boolean,
  identity: string,
  delayMs = MESSAGES_HTTP_FALLBACK_MS,
): boolean {
  const [dueIdentity, setDueIdentity] = useState<string | null>(null);
  useEffect(() => {
    // Forget a spent fallback when streaming turns off, so a later re-enable waits again.
    if (!streamEnabled) { setDueIdentity(null); return; }
    if (receivedFirstPayload) return;
    const timer = setTimeout(() => setDueIdentity(identity), delayMs);
    return () => clearTimeout(timer);
  }, [streamEnabled, receivedFirstPayload, identity, delayMs]);
  return streamEnabled && !receivedFirstPayload && dueIdentity === identity;
}
