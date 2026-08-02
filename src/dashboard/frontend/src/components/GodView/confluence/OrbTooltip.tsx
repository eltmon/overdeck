import type { ReactNode } from 'react';
import { dropRadius, fmtAge, frostFromIdleMinutes, pickOrb, type PickableOrb } from './model';
import type { ConfluenceOrb } from './useConfluenceData';

export interface TooltipAnchor {
  x: number;
  y: number;
  canvasWidth: number;
}

export interface OrbTooltipProps {
  orb: ConfluenceOrb;
  anchor: TooltipAnchor;
  hookRate: number;
  eventsFired: number;
}

export function resolveHoverOrb<T extends PickableOrb>(
  orbs: readonly T[],
  current: T | null,
  x: number,
  y: number,
  inside = true,
): T | null {
  if (!inside) return null;
  if (current && orbs.includes(current)) {
    const dx = x - current.x;
    const dy = y - current.y;
    const radius = dropRadius(current);
    if (dx * dx + dy * dy < radius * radius) return current;
  }
  return pickOrb(orbs, x, y);
}

export function tooltipPosition(
  anchor: TooltipAnchor,
  tooltipWidth = 300,
): { left: number; top: number; flipped: boolean } {
  const flipped = anchor.x + tooltipWidth + 16 > anchor.canvasWidth;
  return {
    left: Math.max(8, flipped ? anchor.x - tooltipWidth - 16 : anchor.x + 16),
    top: Math.max(8, anchor.y + 16),
    flipped,
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="confluence-tooltip-row"><span>{label}</span><b>{children}</b></div>;
}

export function OrbTooltip({ orb, anchor, hookRate, eventsFired }: OrbTooltipProps) {
  const position = tooltipPosition(anchor);
  const frost = Math.round(frostFromIdleMinutes(orb.idleMin) * 100);

  return (
    <div
      className={`confluence-tooltip ${position.flipped ? 'flipped' : ''}`}
      style={{ left: position.left, top: position.top }}
      role="tooltip"
      data-testid="orb-tooltip"
    >
      <strong>{orb.id}</strong>
      <span className="confluence-tooltip-title">{orb.title}</span>
      <div className="confluence-tooltip-chips">
        <b>{orb.stage}</b><b>{orb.role}</b><b>{orb.project}</b><b>{orb.state}</b>
      </div>
      <Field label="Model">{orb.model ?? '—'}</Field>
      <Field label="Harness">{orb.harness ?? '—'}</Field>
      <Field label="Hook rate">{hookRate} ev/m</Field>
      <Field label="Frost">{frost}%</Field>
      <Field label="Events fired">{eventsFired}</Field>
      <Field label="Stale age">{orb.state === 'stale' ? fmtAge(orb.staleMin) : '—'}</Field>
      <Field label="Yield reason">{orb.yieldReason ?? '—'}</Field>
      <Field label="Warning">{orb.warn ?? (orb.broken ? 'stack broken' : '—')}</Field>
      <div className="confluence-tooltip-convoy">
        <span>Convoy</span>
        <b>{orb.convoy?.length ? orb.convoy.map((member) => member.role).join(' · ') : '—'}</b>
      </div>
      <small>click for issue rail →</small>
    </div>
  );
}
