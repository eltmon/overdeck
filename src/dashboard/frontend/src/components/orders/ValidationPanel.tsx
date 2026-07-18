import { AlertTriangle, Eye, Play, XCircle } from 'lucide-react';
import type { OrderBookFindingView } from './BookStrip';

interface ValidationPanelProps {
  blocks: OrderBookFindingView[];
  warns: OrderBookFindingView[];
  starting?: boolean;
  onPreview: () => void;
  onStart: () => void;
}

export function ValidationPanel({ blocks, warns, starting = false, onPreview, onStart }: ValidationPanelProps) {
  const blocked = blocks.length > 0;
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Start validation">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Start validation</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{blocked ? `${blocks.length} blocking` : 'Ready to start'}</span>
      </div>

      <div className="mt-3 grid gap-2">
        {blocks.map((finding) => (
          <div key={`${finding.code}-${finding.issue}`} className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs" role="alert">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span><span className="font-mono text-foreground">{finding.issue}</span> <span className="text-muted-foreground">{finding.message}</span></span>
          </div>
        ))}
        {warns.map((finding) => (
          <div key={`${finding.code}-${finding.issue}`} className="flex items-start gap-2 rounded-md border border-warning/[0.32] bg-warning/[0.08] p-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
            <span><span className="font-mono text-foreground">{finding.issue}</span> <span className="text-muted-foreground">{finding.message}</span></span>
          </div>
        ))}
        {!blocked && warns.length === 0 && <p className="text-xs text-success">✓ No blocking findings.</p>}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" onClick={onPreview} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Eye className="h-3.5 w-3.5" /> Preview brief
        </button>
        <button
          type="button"
          disabled={blocked || starting}
          title={blocked ? 'Resolve every blocking finding before starting this run' : undefined}
          onClick={onStart}
          className="flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="h-3.5 w-3.5" /> {starting ? 'Starting…' : 'Start run'}
        </button>
      </div>
    </section>
  );
}
