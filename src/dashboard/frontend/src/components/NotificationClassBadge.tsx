import { Activity, Brain } from 'lucide-react';

/**
 * The two distinct classes of notification the dashboard surfaces:
 *  - `operational` — pipeline/system events (emitActivityEntry → recentActivity):
 *    agent lifecycle, reviews, merges, git, system messages. No AI involved.
 *  - `memory` — AI-distilled memory observations extracted from agent transcripts.
 *
 * They flow through entirely separate pipelines and used to be indistinguishable
 * at a glance, which is confusing when one feed is full and the other is empty.
 * This badge labels each item with its class so the source is always obvious.
 */
export type NotificationClass = 'operational' | 'memory';

const META: Record<NotificationClass, { label: string; title: string }> = {
  operational: {
    label: 'Event',
    title: 'Operational event — pipeline & system activity (agent lifecycle, reviews, merges, git). Not AI-generated.',
  },
  memory: {
    label: 'Memory',
    title: 'Memory observation — an AI-distilled summary of agent work, extracted from the transcript.',
  },
};

export function NotificationClassBadge({ kind, className = '' }: { kind: NotificationClass; className?: string }) {
  const Icon = kind === 'memory' ? Brain : Activity;
  const { label, title } = META[kind];
  return (
    <span
      data-testid={`notification-class-${kind}`}
      title={title}
      className={`inline-flex h-5 items-center gap-1 rounded-sm border border-border bg-muted/40 px-1.5 text-[10px] font-medium text-muted-foreground ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
