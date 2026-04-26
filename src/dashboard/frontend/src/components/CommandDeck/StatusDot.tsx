/**
 * <StatusDot status size /> — colored circle with status-driven pulse.
 *
 * Pulse keyframes (defined in src/dashboard/frontend/src/index.css):
 *   active   → 1.6s alive-dot
 *   thinking → 2.0s alive-dot + warning glow
 *   waiting  → 1.5s alive-dot + amber glow
 *   idle     → 4.0s alive-dot (very slow breath)
 *   ended    → static dim, no animation
 */

export type StatusDotStatus = 'active' | 'thinking' | 'waiting' | 'idle' | 'ended';
export type StatusDotSize = 'sm' | 'md';

interface StatusDotProps {
  status: StatusDotStatus;
  size?: StatusDotSize;
  title?: string;
  className?: string;
}

const STATUS_COLOR: Record<StatusDotStatus, string> = {
  active: 'var(--success)',
  thinking: 'var(--warning)',
  waiting: 'var(--warning)',
  idle: 'var(--muted-foreground)',
  ended: 'var(--muted-foreground)',
};

const STATUS_ANIM_CLASS: Record<StatusDotStatus, string> = {
  active: 'anim-alive-dot-active',
  thinking: 'anim-alive-dot-thinking',
  waiting: 'anim-alive-dot-waiting',
  idle: 'anim-alive-dot-idle',
  ended: '',
};

const STATUS_GLOW: Partial<Record<StatusDotStatus, string>> = {
  thinking: '0 0 6px color-mix(in srgb, var(--warning) 60%, transparent)',
  waiting: '0 0 6px color-mix(in srgb, var(--warning) 70%, transparent)',
};

export function StatusDot({ status, size = 'sm', title, className }: StatusDotProps) {
  const dim = size === 'md' ? 8 : 6;
  const animClass = STATUS_ANIM_CLASS[status];
  const opacity = status === 'ended' ? 0.45 : 1;
  const boxShadow = STATUS_GLOW[status];

  return (
    <span
      data-testid="status-dot"
      data-status={status}
      data-size={size}
      title={title}
      className={[animClass, className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-block',
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: STATUS_COLOR[status],
        opacity,
        boxShadow,
      }}
    />
  );
}
