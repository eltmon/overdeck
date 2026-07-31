/**
 * <StatusDot status size /> — colored circle with status-driven pulse.
 *
 * Pulse keyframes (defined in src/dashboard/frontend/src/index.css):
 *   active   → 1.6s alive-dot
 *   thinking → 2.0s alive-dot + info glow
 *   waiting  → 1.5s alive-dot + amber glow
 *   reviewing → 1.6s alive-dot (cockpit variant uses specialist purple)
 *   idle     → 4.0s alive-dot by default; cockpit variant is static and hollow
 *   done/ended/error → static, no animation
 */

export type StatusDotStatus = 'active' | 'reviewing' | 'thinking' | 'waiting' | 'idle' | 'done' | 'error' | 'ended';
export type StatusDotSize = 'sm' | 'md';

interface StatusDotProps {
  status: StatusDotStatus;
  size?: StatusDotSize;
  title?: string;
  className?: string;
  variant?: 'default' | 'cockpit';
}

// Style guide v1.2 signal law: blue = machine actively doing something
// (active/thinking), amber = a human must act (waiting for input), neutral =
// no live signal. Emerald is reserved for verified outcomes, never activity.
const DEFAULT_STATUS_COLOR: Record<StatusDotStatus, string> = {
  active: 'var(--info)',
  reviewing: 'var(--info)',
  thinking: 'var(--info)',
  waiting: 'var(--warning)',
  idle: 'var(--muted-foreground)',
  done: 'var(--muted-foreground)',
  error: 'var(--muted-foreground)',
  ended: 'var(--muted-foreground)',
};

const COCKPIT_STATUS_COLOR: Record<StatusDotStatus, string> = {
  ...DEFAULT_STATUS_COLOR,
  reviewing: 'var(--signal-review)',
  done: 'var(--success)',
  error: 'var(--destructive)',
};

const STATUS_ANIM_CLASS: Record<StatusDotStatus, string> = {
  active: 'anim-alive-dot-active',
  reviewing: 'anim-alive-dot-active',
  thinking: 'anim-alive-dot-thinking',
  waiting: 'anim-alive-dot-waiting',
  idle: 'anim-alive-dot-idle',
  done: '',
  error: '',
  ended: '',
};

const STATUS_GLOW: Partial<Record<StatusDotStatus, string>> = {
  thinking: '0 0 6px color-mix(in srgb, var(--info) 60%, transparent)',
  waiting: '0 0 6px color-mix(in srgb, var(--warning) 70%, transparent)',
};

export function StatusDot({ status, size = 'sm', title, className, variant = 'default' }: StatusDotProps) {
  const dim = size === 'md' ? 8 : 6;
  const isCockpitIdle = variant === 'cockpit' && status === 'idle';
  const animClass = isCockpitIdle ? '' : STATUS_ANIM_CLASS[status];
  const opacity = status === 'ended' || (variant === 'default' && status === 'done') ? 0.45 : 1;
  const boxShadow = STATUS_GLOW[status];
  const statusColor = variant === 'cockpit' ? COCKPIT_STATUS_COLOR[status] : DEFAULT_STATUS_COLOR[status];

  return (
    <span
      data-testid="status-dot"
      data-status={status}
      data-size={size}
      data-variant={variant}
      title={title}
      className={[animClass, className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-block',
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: isCockpitIdle ? 'transparent' : statusColor,
        borderWidth: isCockpitIdle ? 1 : undefined,
        borderStyle: isCockpitIdle ? 'solid' : undefined,
        borderColor: isCockpitIdle ? 'var(--muted-foreground)' : undefined,
        opacity,
        boxShadow,
      }}
    />
  );
}
