import type { SessionNode } from '@overdeck/contracts';

export function getTroubledBadgeLabel(session: SessionNode): string {
  const queued = session.queuedMailCount ?? 0;
  return queued > 0 ? `Troubled · ${queued} queued` : 'Troubled';
}

export function getTroubledBadgeTitle(session: SessionNode): string {
  const parts = [
    `Session: ${session.sessionId}.`,
    session.troubledReason ? `Reason: ${session.troubledReason}.` : 'Reason: unavailable.',
    `Failures: ${session.consecutiveFailures ?? 0}.`,
    session.troubledAt ? `Troubled at: ${session.troubledAt}.` : 'Troubled at: unavailable.',
    `Queued deliveries: ${session.queuedMailCount ?? 0}.`,
  ];
  if ((session.consecutiveFailures ?? 0) === 0) {
    parts.push('Likely spurious: troubled with 0 failures.');
  }
  return parts.join(' ');
}
