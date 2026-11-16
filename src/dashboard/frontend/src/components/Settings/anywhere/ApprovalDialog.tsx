/**
 * The two-screen approval (PAN-2356 D-2356-9): both machines show the same six-digit code when
 * nothing sits between them. The approver clicks Approve and the requester Accept only after
 * checking the code on the other screen; a man in the middle makes the two codes differ.
 */
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';

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
    <Modal
      title={mode === 'approve' ? `Link ${label} to this machine` : `Link this machine to ${label}`}
      size="narrow"
      onClose={onClose}
      pinned={error ? <p role="alert" className={formStyles.error}>{error}</p> : null}
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className={formStyles.button}
            style={{ color: 'var(--destructive)' }}
          >
            Reject
          </button>
          <button
            type="button"
            disabled={busy || !sas}
            onClick={onConfirm}
            className={formStyles.primaryButton}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={`${formStyles.content} space-y-3`} data-component="approval-dialog">
        {sas ? (
          <>
            <p className="text-xs text-muted-foreground">Code</p>
            <p data-testid="approval-sas" className="font-mono text-2xl text-foreground tracking-widest">{sas}</p>
            {fingerprint && (
              <p className="text-xs text-muted-foreground">
                {label} fingerprint <span className="font-mono text-foreground">{fingerprint}</span>
              </p>
            )}
            <p className={formStyles.text}>
              {mode === 'approve' ? 'Approve only if the other machine shows the same code.' : 'Accept only if the other machine shows the same code.'}
            </p>
          </>
        ) : (
          <p className={formStyles.hint}>Opening a direct connection to {label}…</p>
        )}
      </div>
    </Modal>
  );
}
