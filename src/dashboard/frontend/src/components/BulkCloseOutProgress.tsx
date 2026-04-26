import { Loader2, CheckCircle, XCircle, SkipForward, X } from 'lucide-react';

export type BulkCloseStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface BulkCloseResult {
  issueId: string;
  status: BulkCloseStatus;
  error?: string;
}

interface BulkCloseOutProgressProps {
  isOpen: boolean;
  results: BulkCloseResult[];
  onClose: () => void;
}

export function BulkCloseOutProgress({ isOpen, results, onClose }: BulkCloseOutProgressProps) {
  if (!isOpen) return null;

  const isComplete = results.every(r => r.status !== 'pending' && r.status !== 'running');
  const succeeded = results.filter(r => r.status === 'done').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  const statusIcon = (status: BulkCloseStatus) => {
    switch (status) {
      case 'pending':
        return <span className="w-4 h-4 rounded-full border-2 border-border" />;
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-primary" />;
      case 'done':
        return <CheckCircle className="w-4 h-4 text-success" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'skipped':
        return <SkipForward className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const statusLabel = (status: BulkCloseStatus) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'running': return 'Running';
      case 'done': return 'Done';
      case 'failed': return 'Failed';
      case 'skipped': return 'Skipped';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={isComplete ? onClose : undefined} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          {isComplete ? 'Bulk Close Out Complete' : 'Closing Out Issues...'}
        </h3>

        <div className="space-y-2 max-h-80 overflow-y-auto mb-4">
          {results.map((result) => (
            <div
              key={result.issueId}
              className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2"
            >
              {statusIcon(result.status)}
              <span className="text-sm font-medium text-foreground flex-1">{result.issueId}</span>
              <span className="text-xs text-muted-foreground">{statusLabel(result.status)}</span>
              {result.error && (
                <span className="text-xs text-destructive max-w-[200px] truncate" title={result.error}>
                  {result.error}
                </span>
              )}
            </div>
          ))}
        </div>

        {isComplete && (
          <div className="mb-4 text-sm text-foreground">
            <span className="font-medium text-success">{succeeded} succeeded</span>
            {failed > 0 && <span className="font-medium text-destructive ml-3">{failed} failed</span>}
            {skipped > 0 && <span className="font-medium text-muted-foreground ml-3">{skipped} skipped</span>}
          </div>
        )}

        <div className="flex justify-end">
          {isComplete ? (
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors text-sm"
            >
              <X className="w-4 h-4" />
              Close
            </button>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
