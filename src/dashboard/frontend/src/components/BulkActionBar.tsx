import { X, Trash2 } from 'lucide-react';

interface BulkActionBarProps {
  count: number;
  onCloseOut: () => void;
  onCancel: () => void;
}

export function BulkActionBar({ count, onCloseOut, onCancel }: BulkActionBarProps) {
  const visible = count > 0;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out ${
        visible
          ? 'translate-y-0 opacity-100 pointer-events-auto'
          : 'translate-y-8 opacity-0 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-lg/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center h-5.5 min-w-5.5 rounded-sm bg-primary/8 border border-primary/32 px-1 text-sm font-medium text-primary tabular-nums">
            {count}
          </span>
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            {count === 1 ? 'issue' : 'issues'} selected
          </span>
        </div>
        <div className="w-px h-5 bg-border" />
        <button
          onClick={onCloseOut}
          className="inline-flex items-center gap-1.5 h-9 rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground transition-shadow duration-200 hover:shadow-xs/5 focus-visible:ring-[3px] focus-visible:ring-ring/24 focus-visible:ring-offset-1"
        >
          <Trash2 className="w-[18px] h-[18px] -mx-0.5" />
          Close Out
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 h-9 rounded-lg bg-transparent px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/24 focus-visible:ring-offset-1"
        >
          <X className="w-[18px] h-[18px] -mx-0.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}
