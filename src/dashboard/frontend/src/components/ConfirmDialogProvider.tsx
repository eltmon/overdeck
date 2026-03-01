import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';

type DialogVariant = 'danger' | 'warning' | 'info';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function useConfirmDialog(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  return ctx;
}

const VARIANT_STYLES: Record<DialogVariant, { icon: typeof AlertTriangle; iconColor: string; confirmBg: string; confirmHoverBg: string }> = {
  danger: {
    icon: AlertTriangle,
    iconColor: 'text-red-400',
    confirmBg: 'bg-red-600',
    confirmHoverBg: 'hover:bg-red-700',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-orange-400',
    confirmBg: 'bg-orange-600',
    confirmHoverBg: 'hover:bg-orange-700',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    confirmBg: 'bg-blue-600',
    confirmHoverBg: 'hover:bg-blue-700',
  },
};

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialogState((prev) => {
        // Resolve any pending promise as false to prevent orphaned promises
        prev?.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    dialogState?.resolve(true);
    setDialogState(null);
  }, [dialogState]);

  const handleCancel = useCallback(() => {
    dialogState?.resolve(false);
    setDialogState(null);
  }, [dialogState]);

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!dialogState) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      } else if (e.key === 'Tab') {
        // Simple focus trap
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled])'
        );
        if (!focusable || focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Auto-focus cancel button (safe default)
    setTimeout(() => {
      const cancelBtn = dialogRef.current?.querySelector<HTMLElement>('[data-cancel]');
      cancelBtn?.focus();
    }, 0);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dialogState, handleCancel]);

  if (!dialogState) {
    return (
      <ConfirmDialogContext.Provider value={{ confirm }}>
        {children}
      </ConfirmDialogContext.Provider>
    );
  }

  const { options } = dialogState;
  const variant = options.variant || 'warning';
  const styles = VARIANT_STYLES[variant];
  const Icon = styles.icon;

  // Split message by newlines to render multi-line messages properly
  const messageLines = options.message.split('\n');

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {children}

      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
        onClick={handleCancel}
        role="presentation"
      >
        {/* Dialog */}
        <div
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
            <div className="flex items-center gap-2">
              <Icon className={`w-5 h-5 ${styles.iconColor}`} />
              <h3 id="confirm-dialog-title" className="text-lg font-semibold text-content">
                {options.title || 'Confirm Action'}
              </h3>
            </div>
            <button
              onClick={handleCancel}
              className="text-content-subtle hover:text-content-body transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div id="confirm-dialog-desc" className="p-4">
            <div className="text-sm text-content-body whitespace-pre-wrap space-y-1">
              {messageLines.map((line, i) => {
                // Render bullet points with proper formatting
                if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
                  return <div key={i} className="pl-2">{line}</div>;
                }
                return <div key={i}>{line || '\u00A0'}</div>;
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider bg-surface/30">
            <button
              data-cancel
              onClick={handleCancel}
              className="px-4 py-2 rounded text-sm bg-surface-overlay text-content-body hover:bg-surface-emphasis transition-colors"
            >
              {options.cancelLabel || 'Cancel'}
            </button>
            <button
              onClick={handleConfirm}
              className={`px-4 py-2 rounded text-sm ${styles.confirmBg} text-white ${styles.confirmHoverBg} transition-colors font-medium`}
            >
              {options.confirmLabel || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </ConfirmDialogContext.Provider>
  );
}
