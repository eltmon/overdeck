import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmDialogOptions } from './ConfirmDialog';
import { AlertNoticeDialog, type AlertDialogOptions } from './AlertNoticeDialog';

type ConfirmFn = (options: ConfirmDialogOptions) => Promise<boolean>;
type AlertFn = (options: AlertDialogOptions) => Promise<void>;

interface DialogContextValue {
  confirm: ConfirmFn;
  alert: AlertFn;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useConfirm must be used within DialogProvider');
  return ctx.confirm;
}

export function useAlert(): AlertFn {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useAlert must be used within DialogProvider');
  return ctx.alert;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirmOptions, setConfirmOptions] = useState<ConfirmDialogOptions | null>(null);
  const [alertOptions, setAlertOptions] = useState<AlertDialogOptions | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);
  const alertResolveRef = useRef<(() => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // Dismiss any pending confirm dialog (resolves false to avoid orphaned promise)
    if (confirmResolveRef.current) {
      confirmResolveRef.current(false);
    }
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmOptions(options);
    });
  }, []);

  const alert = useCallback<AlertFn>((options) => {
    // Dismiss any pending alert dialog (resolves to avoid orphaned promise)
    if (alertResolveRef.current) {
      alertResolveRef.current();
    }
    return new Promise<void>((resolve) => {
      alertResolveRef.current = resolve;
      setAlertOptions(options);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
    setConfirmOptions(null);
  }, []);

  const handleCancel = useCallback(() => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = null;
    setConfirmOptions(null);
  }, []);

  const handleAlertClose = useCallback(() => {
    alertResolveRef.current?.();
    alertResolveRef.current = null;
    setAlertOptions(null);
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {confirmOptions && (
        <ConfirmDialog
          options={confirmOptions}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {alertOptions && (
        <AlertNoticeDialog
          options={alertOptions}
          onClose={handleAlertClose}
        />
      )}
    </DialogContext.Provider>
  );
}
