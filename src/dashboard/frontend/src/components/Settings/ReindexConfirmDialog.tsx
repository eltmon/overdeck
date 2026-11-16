/**
 * Confirmation modal for conversation-search reindex actions.
 *
 * Used both when the user clicks "Estimate & reindex" and when they switch the
 * embedding model (which invalidates cached embeddings and triggers a paid full
 * reindex). Replaces the old window.confirm() with a styled, cost-aware dialog.
 */

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

import { Modal } from '../shared/Modal';
import formStyles from '../shared/ModalForm.module.css';

interface ReindexEstimate {
  estimatedUsd: number;
  tokenCount: number;
  chunksEstimated: number;
  filesScanned: number;
  disabled: boolean;
  unavailableReason?: string;
}

interface ReindexConfirmDialogProps {
  open: boolean;
  title: string;
  intro: ReactNode;
  estimate: ReindexEstimate | null;
  /** True while the cost estimate is still being computed. */
  estimating?: boolean;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ReindexConfirmDialog({
  open,
  title,
  intro,
  estimate,
  estimating = false,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: ReindexConfirmDialogProps) {
  if (!open) return null;

  return (
    <Modal
      title={title}
      size="narrow"
      onClose={onCancel}
      dismissible={!busy}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className={formStyles.button}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || estimating || !estimate || estimate.disabled}
            className={formStyles.primaryButton}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={`${formStyles.content} space-y-3 text-sm text-muted-foreground`}>
        <div className="leading-relaxed">{intro}</div>

        {estimating && !estimate && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Estimating cost (scanning transcripts)…
          </div>
        )}

        {estimate && !estimate.disabled && (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span>Estimated cost</span>
              <span className="text-foreground font-medium">${estimate.estimatedUsd.toFixed(4)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens to embed</span>
              <span className="text-foreground">{estimate.tokenCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Chunks · files</span>
              <span className="text-foreground">
                {estimate.chunksEstimated.toLocaleString()} · {estimate.filesScanned.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {estimate?.disabled && estimate.unavailableReason && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {estimate.unavailableReason}
          </div>
        )}
      </div>
    </Modal>
  );
}
