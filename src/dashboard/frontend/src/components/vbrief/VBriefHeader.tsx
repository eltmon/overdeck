import type { VBriefDocument } from './types';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-bg-muted text-text-secondary',
  proposed: 'badge-bg-primary text-primary',
  approved: 'badge-bg-success text-success',
  pending: 'badge-bg-warning text-warning',
  running: 'badge-bg-primary text-primary',
  completed: 'badge-bg-success text-success',
  blocked: 'badge-bg-destructive text-destructive',
  cancelled: 'badge-bg-muted text-text-muted',
};

function fmt(ts?: string): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return ts;
  }
}

interface VBriefHeaderProps {
  doc: VBriefDocument;
}

export function VBriefHeader({ doc }: VBriefHeaderProps) {
  const { plan, vBRIEFInfo } = doc;
  const badgeCls = STATUS_BADGE[plan.status] ?? 'badge-bg-muted text-text-secondary';

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground leading-tight">{plan.title}</h2>
        <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${badgeCls}`}>
          {plan.status}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-text-muted">
        {plan.uid && (
          <div className="col-span-2">
            <span className="text-content-muted">uid </span>
            <span className="font-mono text-text-secondary">{plan.uid}</span>
          </div>
        )}
        {plan.author && (
          <div>
            <span className="text-content-muted">author </span>
            <span className="text-text-secondary">{plan.author}</span>
          </div>
        )}
        {vBRIEFInfo.author && (
          <div>
            <span className="text-content-muted">tool </span>
            <span className="text-text-secondary">{vBRIEFInfo.author}</span>
          </div>
        )}
        {plan.created && (
          <div>
            <span className="text-content-muted">created </span>
            <span className="text-text-secondary">{fmt(plan.created)}</span>
          </div>
        )}
        {plan.updated && (
          <div>
            <span className="text-content-muted">updated </span>
            <span className="text-text-secondary">{fmt(plan.updated)}</span>
          </div>
        )}
        {plan.sequence !== undefined && (
          <div>
            <span className="text-content-muted">seq </span>
            <span className="text-text-secondary">{plan.sequence}</span>
          </div>
        )}
      </div>
    </div>
  );
}
