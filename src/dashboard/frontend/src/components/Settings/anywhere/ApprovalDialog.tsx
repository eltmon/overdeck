/**
 * The two-screen approval (PAN-2356 D-2356-9): both machines show the same six-digit code when
 * nothing sits between them. The approver clicks Approve and the requester Accept only after
 * checking the code on the other screen; a man in the middle makes the two codes differ.
 */
import { X } from 'lucide-react';

export interface ApprovalDialogProps {
  mode: 'approve' | 'accept';
  /** The other machine's label. */
  label: string;
  sas: string | null;
  /** The other machine's fingerprint, from the handshake key. */
  fingerprint: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onReject: () => void;
  onClose: () => void;
}

export function ApprovalDialog({ mode, label, sas, fingerprint, busy, error, onConfirm, onReject, onClose }: ApprovalDialogProps) {
  const confirmLabel = mode === 'approve' ? 'Approve' : 'Accept';
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-dialog-title"
        data-component="approval-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="approval-dialog-title" className="text-base font-medium text-foreground">
            {mode === 'approve' ? `Link ${label} to this machine` : `Link this machine to ${label}`}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          {sas ? (
            <>
              <p className="text-xs text-muted-foreground">Code</p>
              <p data-testid="approval-sas" className="font-mono text-2xl text-foreground tracking-widest">{sas}</p>
              {fingerprint && (
                <p className="text-xs text-muted-foreground">
                  {label} fingerprint <span className="font-mono text-foreground">{fingerprint}</span>
                </p>
              )}
              <p className="text-xs text-foreground">
                {mode === 'approve' ? 'Approve only if the other machine shows the same code.' : 'Accept only if the other machine shows the same code.'}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Opening a direct connection to {label}…</p>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy || !sas}
              onClick={onConfirm}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
