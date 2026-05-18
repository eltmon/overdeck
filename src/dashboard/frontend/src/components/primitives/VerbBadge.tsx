import { cn } from '../../lib/utils';

export type VerbBadgeVariant =
  | 'WORK RUNNING'
  | 'REVIEW RUNNING'
  | 'SHIP RUNNING'
  | 'PLANNING'
  | 'INPUT'
  | 'READY TO MERGE'
  | 'MERGED'
  | 'CHANGES REQUESTED'
  | 'STUCK · Nh'
  | 'QUEUED FOR PLAN';

type StaticVerbBadgeVariant = Exclude<VerbBadgeVariant, 'STUCK · Nh'>;

type VerbBadgeConfig = {
  label: string;
  className: string;
  pulse: boolean;
};

const STATIC_VARIANTS = {
  'WORK RUNNING': {
    label: 'WORK RUNNING',
    className: 'badge-bg-info badge-border-info text-info-foreground',
    pulse: true,
  },
  'REVIEW RUNNING': {
    label: 'REVIEW RUNNING',
    className: 'badge-bg-warning badge-border-warning text-warning-foreground',
    pulse: true,
  },
  'SHIP RUNNING': {
    label: 'SHIP RUNNING',
    className: 'badge-bg-signal-review badge-border-signal-review text-signal-review-foreground',
    pulse: true,
  },
  PLANNING: {
    label: 'PLANNING',
    className: 'badge-bg-signal-review badge-border-signal-review text-signal-review-foreground',
    pulse: true,
  },
  INPUT: {
    label: 'INPUT',
    className: 'badge-bg-warning badge-border-warning text-warning-foreground',
    pulse: true,
  },
  'READY TO MERGE': {
    label: 'READY TO MERGE',
    className: 'badge-bg-success badge-border-success text-success-foreground',
    pulse: false,
  },
  MERGED: {
    label: 'MERGED',
    className: 'badge-bg-success badge-border-success text-success-foreground',
    pulse: false,
  },
  'CHANGES REQUESTED': {
    label: 'CHANGES REQUESTED',
    className: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
    pulse: false,
  },
  'QUEUED FOR PLAN': {
    label: 'QUEUED FOR PLAN',
    className: 'bg-transparent border-border text-muted-foreground',
    pulse: false,
  },
} satisfies Record<StaticVerbBadgeVariant, VerbBadgeConfig>;

const STUCK_CONFIG = {
  className: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
  pulse: false,
} satisfies Omit<VerbBadgeConfig, 'label'>;

type StaticVerbBadgeProps = {
  variant: StaticVerbBadgeVariant;
  hours?: never;
  className?: string;
};

type StuckVerbBadgeProps = {
  variant: 'STUCK · Nh';
  hours: number;
  className?: string;
};

export type VerbBadgeProps = StaticVerbBadgeProps | StuckVerbBadgeProps;

export default function VerbBadge(props: VerbBadgeProps) {
  const config = props.variant === 'STUCK · Nh'
    ? { ...STUCK_CONFIG, label: `STUCK · ${props.hours}h` }
    : STATIC_VARIANTS[props.variant];

  return (
    <span
      data-component="verb-badge"
      data-variant={props.variant}
      className={cn(
        'inline-flex items-center gap-[5px] rounded-[var(--radius-sm)] border px-[6px] py-[2px] text-[10px] font-medium uppercase leading-none tracking-[0.05em]',
        config.className,
        props.className,
      )}
    >
      {config.pulse && (
        <span
          aria-hidden="true"
          className="h-[6px] w-[6px] rounded-full bg-current verb-badge-pulse"
        />
      )}
      <span>{config.label}</span>
    </span>
  );
}
