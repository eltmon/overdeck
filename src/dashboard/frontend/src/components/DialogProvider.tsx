import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle, Info, CheckCircle, XCircle, X } from 'lucide-react';

// --- Types ---

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
}

interface AlertOptions {
  title?: string;
  message: string;
  variant?: 'info' | 'error' | 'success';
}

interface DialogState {
  type: 'confirm' | 'alert';
  options: ConfirmOptions | AlertOptions;
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm must be used within DialogProvider');
  return ctx.confirm;
}

export function useAlert() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useAlert must be used within DialogProvider');
  return ctx.alert;
}

// --- Dialog Components ---

function ConfirmDialogContent({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const isDestructive = options.variant === 'destructive';

  useEffect(() => {
    if (isDestructive) {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [isDestructive]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-divider">
          {isDestructive ? (
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
          ) : (
            <Info className="w-5 h-5 text-info shrink-0" />
          )}
          <h3 id="dialog-title" className="text-lg font-semibold text-content">{options.title}</h3>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <p id="dialog-message" className="text-sm text-content-body whitespace-pre-line">{options.message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-divider">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 rounded text-sm bg-surface-overlay text-content-body hover:bg-surface-emphasis transition-colors"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              isDestructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AlertDialogContent({
  options,
  onClose,
}: {
  options: AlertOptions;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const iconMap = {
    info: <Info className="w-5 h-5 text-info shrink-0" />,
    error: <XCircle className="w-5 h-5 text-destructive shrink-0" />,
    success: <CheckCircle className="w-5 h-5 text-success shrink-0" />,
  };

  const variant = options.variant || 'info';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-message"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            {iconMap[variant]}
            <h3 id="alert-title" className="text-lg font-semibold text-content">
              {options.title || (variant === 'error' ? 'Error' : variant === 'success' ? 'Success' : 'Notice')}
            </h3>
          </div>
          <button onClick={onClose} className="text-content-subtle hover:text-content-body transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <p id="alert-message" className="text-sm text-content-body whitespace-pre-line">{options.message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-divider">
          <button
            ref={closeRef}
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Provider ---

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const pendingRef = useRef<DialogState | null>(null);

  const dismissPending = useCallback(() => {
    if (pendingRef.current) {
      pendingRef.current.resolve(false);
      pendingRef.current = null;
    }
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    dismissPending();
    return new Promise<boolean>((resolve) => {
      const state: DialogState = { type: 'confirm', options, resolve };
      pendingRef.current = state;
      setDialog(state);
    });
  }, [dismissPending]);

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    dismissPending();
    return new Promise<void>((resolve) => {
      const state: DialogState = { type: 'alert', options, resolve: () => resolve() };
      pendingRef.current = state;
      setDialog(state);
    });
  }, [dismissPending]);

  const handleConfirm = useCallback(() => {
    dialog?.resolve(true);
    pendingRef.current = null;
    setDialog(null);
  }, [dialog]);

  const handleCancel = useCallback(() => {
    dialog?.resolve(false);
    pendingRef.current = null;
    setDialog(null);
  }, [dialog]);

  const handleAlertClose = useCallback(() => {
    dialog?.resolve(false);
    pendingRef.current = null;
    setDialog(null);
  }, [dialog]);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog?.type === 'confirm' && (
        <ConfirmDialogContent
          options={dialog.options as ConfirmOptions}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {dialog?.type === 'alert' && (
        <AlertDialogContent
          options={dialog.options as AlertOptions}
          onClose={handleAlertClose}
        />
      )}
    </DialogContext.Provider>
  );
}
