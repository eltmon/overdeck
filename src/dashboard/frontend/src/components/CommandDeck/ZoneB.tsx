/**
 * ZoneB — agent context strip for the unified Command Deck (PAN-830, pan-11sr).
 *
 * Visible only in agent-selected mode. Shows the focused session's role/type,
 * presence, model, and elapsed duration. Reuses the pan-d53s liveness building
 * blocks (`<RoleBadge>` + `<StatusDot>`) so the strip already has gentle
 * motion when something is alive.
 *
 * Phase, round number, current tool, and per-session cost will land in
 * follow-up beads — they require subscribing to live agent events that are
 * out of scope for the Phase-2 shell.
 */

import type { SessionNode as SessionNodeType, SessionNodePresence } from '@panopticon/contracts';
import { RoleBadge, type ReviewerRole } from './RoleBadge';
import { StatusDot, type StatusDotStatus } from './StatusDot';

interface ZoneBProps {
  session: SessionNodeType;
}

const REVIEWER_ROLES: readonly ReviewerRole[] = [
  'correctness',
  'security',
  'performance',
  'requirements',
  'synthesis',
];

function isReviewerRole(value: string | undefined): value is ReviewerRole {
  return !!value && (REVIEWER_ROLES as readonly string[]).includes(value);
}

function presenceToStatus(presence: SessionNodePresence): StatusDotStatus {
  switch (presence) {
    case 'active': return 'active';
    case 'idle':   return 'idle';
    case 'ended':  return 'ended';
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function ZoneB({ session }: ZoneBProps) {
  const reviewerRole = isReviewerRole(session.role) ? session.role : undefined;
  const status = presenceToStatus(session.presence);
  const label = session.role ? `${session.type}:${session.role}` : session.type;

  return (
    <div
      data-testid="zone-b"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mc-space-3, 8px)',
        padding: '6px 12px',
        borderBottom: '1px solid var(--mc-border, var(--border))',
        background: 'var(--mc-surface-2, color-mix(in srgb, var(--foreground) 3%, transparent))',
        fontSize: 12,
        color: 'var(--mc-text, var(--foreground))',
      }}
    >
      <RoleBadge role={session.type} role_={reviewerRole} size="sm" />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <StatusDot status={status} title={`presence: ${session.presence}`} />
      <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
        {session.model}
      </span>
      <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))', marginLeft: 'auto' }}>
        {formatDuration(session.duration)}
      </span>
    </div>
  );
}
