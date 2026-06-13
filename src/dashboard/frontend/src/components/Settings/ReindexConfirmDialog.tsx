/**
 * Confirmation modal for conversation-search reindex actions.
 *
 * Used both when the user clicks "Estimate & reindex" and when they switch the
 * embedding model (which invalidates cached embeddings and triggers a paid full
 * reindex). Replaces the old window.confirm() with a styled, cost-aware dialog.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm text-muted-foreground">
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

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || estimating || !estimate || estimate.disabled}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
