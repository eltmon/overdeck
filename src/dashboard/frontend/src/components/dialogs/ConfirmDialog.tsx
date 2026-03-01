import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

interface ConfirmDialogProps {
  options: ConfirmDialogOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ options, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const {
    title = 'Confirm',
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
  } = options;

  const isDestructive = variant === 'destructive';

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      // Trap focus within dialog
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4 animate-fade-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            {isDestructive && <AlertTriangle className="w-5 h-5 text-red-400" />}
            <h3 id="confirm-dialog-title" className="text-lg font-semibold text-content">
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="text-content-subtle hover:text-content-body transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div id="confirm-dialog-message" className="p-4">
          <p className="text-sm text-content-body whitespace-pre-line">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-surface/30">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm bg-surface-overlay text-content-body hover:bg-surface-emphasis transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              isDestructive
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
