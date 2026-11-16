import { Loader2, CheckCircle, XCircle, SkipForward, X } from 'lucide-react';
import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

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
    <Modal
      title={isComplete ? 'Bulk Close Out Complete' : 'Closing Out Issues...'}
      onClose={onClose}
      dismissible={isComplete}
      footer={isComplete ? (
        <button type="button" onClick={onClose} className={formStyles.primaryButton}>
          <X className="w-4 h-4" />
          Close
        </button>
      ) : (
        <p className={formStyles.status}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Processing...
        </p>
      )}
    >
      <div className={`${formStyles.content} space-y-4`}>
        <div className="space-y-2 max-h-80 overflow-y-auto">
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
          <div className="text-sm text-foreground">
            <span className="font-medium text-success">{succeeded} succeeded</span>
            {failed > 0 && <span className="font-medium text-destructive ml-3">{failed} failed</span>}
            {skipped > 0 && <span className="font-medium text-muted-foreground ml-3">{skipped} skipped</span>}
          </div>
        )}
      </div>
    </Modal>
  );
}
