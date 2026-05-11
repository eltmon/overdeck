import type { VBriefDocument, VBriefInspectionPolicy } from './types';

const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-bg-muted text-muted-foreground',
  proposed: 'badge-bg-primary text-primary',
  approved: 'badge-bg-success text-success',
  pending: 'badge-bg-warning text-warning',
  running: 'badge-bg-primary text-primary',
  completed: 'badge-bg-success text-success',
  blocked: 'badge-bg-destructive text-destructive',
  cancelled: 'badge-bg-muted text-muted-foreground',
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
  onInspectionPolicyChange?: (policy: VBriefInspectionPolicy) => void;
  isUpdatingInspectionPolicy?: boolean;
}

export function VBriefHeader({ doc, onInspectionPolicyChange, isUpdatingInspectionPolicy = false }: VBriefHeaderProps) {
  const { plan, vBRIEFInfo } = doc;
  const badgeCls = STATUS_BADGE[plan.status] ?? 'badge-bg-muted text-muted-foreground';

  return (
    <div className="p-4 border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground leading-tight">{plan.title}</h2>
        <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${badgeCls}`}>
          {plan.status}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {plan.uid && (
          <div className="col-span-2">
            <span className="text-muted-foreground">uid </span>
            <span className="font-mono text-muted-foreground">{plan.uid}</span>
          </div>
        )}
        {plan.author && (
          <div>
            <span className="text-muted-foreground">author </span>
            <span className="text-muted-foreground">{plan.author}</span>
          </div>
        )}
        {vBRIEFInfo.author && (
          <div>
            <span className="text-muted-foreground">tool </span>
            <span className="text-muted-foreground">{vBRIEFInfo.author}</span>
          </div>
        )}
        {plan.created && (
          <div>
            <span className="text-muted-foreground">created </span>
            <span className="text-muted-foreground">{fmt(plan.created)}</span>
          </div>
        )}
        {plan.updated && (
          <div>
            <span className="text-muted-foreground">updated </span>
            <span className="text-muted-foreground">{fmt(plan.updated)}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">inspection </span>
          {onInspectionPolicyChange ? (
            <select
              aria-label="Inspection policy"
              className="bg-card border border-border rounded px-1 py-0.5 text-xs text-muted-foreground"
              value={vBRIEFInfo.inspectionPolicy ?? 'auto'}
              disabled={isUpdatingInspectionPolicy}
              onChange={(event) => onInspectionPolicyChange(event.target.value as VBriefInspectionPolicy)}
            >
              <option value="auto">auto</option>
              <option value="never">never</option>
              <option value="fast">fast</option>
              <option value="deep">deep</option>
            </select>
          ) : (
            <span className="text-muted-foreground">{vBRIEFInfo.inspectionPolicy ?? 'auto'}</span>
          )}
        </div>
        {plan.sequence !== undefined && (
          <div>
            <span className="text-muted-foreground">seq </span>
            <span className="text-muted-foreground">{plan.sequence}</span>
          </div>
        )}
      </div>
    </div>
  );
}
