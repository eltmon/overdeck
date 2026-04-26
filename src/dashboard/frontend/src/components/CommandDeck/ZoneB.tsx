/**
 * ZoneB — agent context strip for the unified Command Deck (PAN-830, pan-11sr).
 *
 * Visible only in agent-selected mode. Shows the focused session's role/type,
 * presence, model, and elapsed duration. Reuses the pan-d53s liveness building
 * blocks (<RoleBadge> + <StatusDot>) so the strip already has gentle
 * motion when something is alive.
 *
 * Includes <ZoneBActionStrip> for session-scoped actions (stopSession,
 * viewTerminal) so the full canonical action surface is reachable.
 */

import { useMemo } from 'react';
import type { SessionNode as SessionNodeType, SessionNodePresence } from '@panopticon/contracts';
import { useLiveFlash } from '../../lib/useLiveFlash';
import { RoleBadge, type ReviewerRole } from './RoleBadge';
import { StatusDot, type StatusDotStatus } from './StatusDot';
import { ZoneBActionStrip } from './ZoneBActionStrip';
import { RoundCard, type RoundData, type RoundVerdict } from './RoundCard';
import { ToolFlash } from './ToolFlash';

interface ZoneBProps {
  session: SessionNodeType;
  onViewTerminal?: () => void;
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

function mapRoundStatus(status?: string): RoundVerdict {
  switch (status) {
    case 'passed':
    case 'approved':
      return 'passed';
    case 'failed':
    case 'blocked':
      return 'failed';
    case 'running':
    case 'active':
      return 'running';
    default:
      return 'pending';
  }
}

export function ZoneB({ session, onViewTerminal }: ZoneBProps) {
  const reviewerRole = isReviewerRole(session.role) ? session.role : undefined;
  const status = presenceToStatus(session.presence);
  const label = session.role ? `${session.type}:${session.role}` : session.type;

  // Live flash when session presence or status changes (blocker-8)
  const flashKey = `${session.sessionId}:${session.presence}:${session.status}`;
  const flashClass = useLiveFlash(flashKey, 'anim-row-flash', 600);

  // Round history mini-cards from roundMetadata (PAN-830 high-1)
  const roundHistory = useMemo(() => {
    if (!session.roundMetadata?.history?.length) return [];
    return session.roundMetadata.history.map((r): RoundData => ({
      round: r.round,
      verdict: mapRoundStatus(r.status),
      findings: typeof r.findings === 'number' ? r.findings : undefined,
      duration: r.durationSec ?? undefined,
      cost: r.cost ?? undefined,
    }));
  }, [session.roundMetadata]);

  const isIdle = session.presence === 'idle';

  return (
    <div
      data-testid="zone-b"
      className={flashClass}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: '1px solid var(--mc-border, var(--border))',
        background: 'var(--mc-surface-2, color-mix(in srgb, var(--foreground) 3%, transparent))',
        fontSize: 12,
        color: 'var(--mc-text, var(--foreground))',
      }}
    >
      {/* Main strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--mc-space-3, 8px)',
          padding: '6px 12px',
        }}
      >
        <RoleBadge role={session.type} role_={reviewerRole} size="sm" />
        <span style={{ fontWeight: 600 }}>{label}</span>
        <StatusDot status={status} title={`presence: ${session.presence}`} />
        <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))' }}>
          {session.model}
        </span>
        {/* Phase + tool inline (PAN-830 high-1) */}
        <ToolFlash currentTool={session.status} />
        <span style={{ color: 'var(--mc-text-muted, var(--muted-foreground))', marginLeft: 'auto' }}>
          {formatDuration(session.duration)}
        </span>
        <ZoneBActionStrip session={session} onViewTerminal={onViewTerminal} />
      </div>

      {/* Idle warning ribbon (PAN-830 high-1) */}
      {isIdle && (
        <div
          style={{
            padding: '2px 12px',
            fontSize: 11,
            color: 'var(--mc-warning, #f97316)',
            background: 'color-mix(in srgb, var(--mc-warning) 8%, transparent)',
            borderTop: '1px dashed var(--mc-border, var(--border))',
          }}
        >
          Session idle — agent waiting for next turn
        </div>
      )}

      {/* Round history mini-cards (PAN-830 high-1) */}
      {roundHistory.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 12px',
            borderTop: '1px dashed var(--mc-border, var(--border))',
            overflowX: 'auto',
          }}
        >
          {roundHistory.map((r) => (
            <RoundCard
              key={r.round}
              round={r}
              active={r.round === session.roundMetadata?.latestRound}
            />
          ))}
        </div>
      )}
    </div>
  );
}
