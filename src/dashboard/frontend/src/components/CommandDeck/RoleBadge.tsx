import {
  Brain,
  Hammer,
  ShieldCheck,
  GitMerge,
  CheckCircle2,
  Bug,
  Lock,
  Gauge,
  ListChecks,
  Sparkles,
  HelpCircle,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import type { SessionNodeType } from '@panctl/contracts';

/**
 * <RoleBadge role role_ size /> — icon + ring color by session role.
 *
 * Wraps a lucide icon with a colored ring matching the role's semantic color.
 * Reviewer roles drill down further: correctness/security/performance/requirements/synthesis.
 */

export type ReviewerRole =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'requirements'
  | 'synthesis';

export type RoleBadgeSize = 'sm' | 'md' | 'lg';

interface RoleBadgeProps {
  role: SessionNodeType;
  role_?: ReviewerRole;
  size?: RoleBadgeSize;
  className?: string;
}

const SIZE_PX: Record<RoleBadgeSize, { box: number; icon: number }> = {
  sm: { box: 18, icon: 12 },
  md: { box: 24, icon: 16 },
  lg: { box: 32, icon: 20 },
};

interface RoleStyle {
  Icon: LucideIcon;
  ring: string;
  fg: string;
}

const SESSION_STYLE: Record<SessionNodeType, RoleStyle> = {
  planning: { Icon: Brain, ring: 'var(--info)', fg: 'var(--info)' },
  work: { Icon: Hammer, ring: 'var(--primary)', fg: 'var(--primary)' },
  review: { Icon: ShieldCheck, ring: 'var(--signal-review)', fg: 'var(--signal-review)' },
  reviewer: { Icon: ShieldCheck, ring: 'var(--signal-review)', fg: 'var(--signal-review)' },
  test: { Icon: CheckCircle2, ring: 'var(--success)', fg: 'var(--success)' },
  ship: { Icon: Rocket, ring: 'var(--success)', fg: 'var(--success)' },
  merge: { Icon: GitMerge, ring: 'var(--success)', fg: 'var(--success)' },
  legacy: { Icon: HelpCircle, ring: 'var(--muted-foreground)', fg: 'var(--muted-foreground)' },
};

const REVIEWER_STYLE: Record<ReviewerRole, RoleStyle> = {
  correctness: { Icon: Bug, ring: 'var(--signal-review)', fg: 'var(--signal-review)' },
  security: { Icon: Lock, ring: 'var(--destructive)', fg: 'var(--destructive)' },
  performance: { Icon: Gauge, ring: 'var(--warning)', fg: 'var(--warning)' },
  requirements: { Icon: ListChecks, ring: 'var(--info)', fg: 'var(--info)' },
  synthesis: { Icon: Sparkles, ring: 'var(--success)', fg: 'var(--success)' },
};

export function RoleBadge({ role, role_, size = 'sm', className }: RoleBadgeProps) {
  const style =
    role === 'reviewer' && role_ ? REVIEWER_STYLE[role_] : SESSION_STYLE[role];
  const dim = SIZE_PX[size];
  const { Icon } = style;
  const dataRole = role === 'reviewer' && role_ ? `${role}:${role_}` : role;

  return (
    <span
      data-testid="role-badge"
      data-role={dataRole}
      data-size={size}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim.box,
        height: dim.box,
        borderRadius: '50%',
        border: `1.5px solid ${style.ring}`,
        background: `color-mix(in srgb, ${style.fg} 6%, transparent)`,
        color: style.fg,
        flexShrink: 0,
      }}
    >
      <Icon size={dim.icon} strokeWidth={2} />
    </span>
  );
}
