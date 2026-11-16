import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

import { Modal } from './shared/Modal';
import formStyles from './shared/ModalForm.module.css';

// --- Types ---

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  requiredText?: string;
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
  const [confirmationText, setConfirmationText] = useState('');
  const isDestructive = options.variant === 'destructive';
  const requiresText = !!options.requiredText;
  const confirmationMatches = !requiresText || confirmationText === options.requiredText;

  useEffect(() => {
    if (isDestructive) {
      cancelRef.current?.focus();
    } else {
      confirmRef.current?.focus();
    }
  }, [isDestructive]);

  return (
    <Modal
      title={options.title}
      size="narrow"
      alert
      describedBy="dialog-message"
      onClose={onCancel}
      footer={
        <>
          <button ref={cancelRef} type="button" onClick={onCancel} className={formStyles.button}>
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={!confirmationMatches}
            className={isDestructive ? formStyles.destructiveButton : formStyles.primaryButton}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </>
      }
    >
      <div className={formStyles.form}>
        <p id="dialog-message" className={`${formStyles.text} whitespace-pre-line select-text cursor-text`}>{options.message}</p>
        {requiresText ? (
          <label className={formStyles.field}>
            <span className={formStyles.label}>
              Type <span className={formStyles.mono}>{options.requiredText}</span> to confirm
            </span>
            <input
              className={formStyles.input}
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              aria-label="Confirmation text"
              autoFocus
            />
          </label>
        ) : null}
      </div>
    </Modal>
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

  const variant = options.variant || 'info';

  return (
    <Modal
      title={options.title || (variant === 'error' ? 'Error' : variant === 'success' ? 'Success' : 'Notice')}
      size="narrow"
      alert
      describedBy="alert-message"
      onClose={onClose}
      footer={
        <button ref={closeRef} type="button" onClick={onClose} className={formStyles.primaryButton}>
          OK
        </button>
      }
    >
      <div className={formStyles.content}>
        <p id="alert-message" className={`${formStyles.text} whitespace-pre-line select-text cursor-text`}>{options.message}</p>
      </div>
    </Modal>
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
