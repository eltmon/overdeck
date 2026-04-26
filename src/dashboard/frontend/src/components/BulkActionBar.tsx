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
      <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.2)] px-5 py-3">
        <span className="text-sm font-medium text-foreground whitespace-nowrap">
          {count} {count === 1 ? 'issue' : 'issues'} selected
        </span>
        <div className="w-px h-5 bg-divider" />
        <button
          onClick={onCloseOut}
          className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Close Out
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}
