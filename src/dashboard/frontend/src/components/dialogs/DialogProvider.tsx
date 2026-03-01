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

interface PendingConfirm {
  options: ConfirmDialogOptions;
  resolve: (value: boolean) => void;
}

interface PendingAlert {
  options: AlertDialogOptions;
  resolve: () => void;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingAlert, setPendingAlert] = useState<PendingAlert | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);
  const alertResolveRef = useRef<(() => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setPendingConfirm({ options, resolve });
    });
  }, []);

  const alert = useCallback<AlertFn>((options) => {
    return new Promise<void>((resolve) => {
      alertResolveRef.current = resolve;
      setPendingAlert({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    confirmResolveRef.current?.(true);
    confirmResolveRef.current = null;
    setPendingConfirm(null);
  }, []);

  const handleCancel = useCallback(() => {
    confirmResolveRef.current?.(false);
    confirmResolveRef.current = null;
    setPendingConfirm(null);
  }, []);

  const handleAlertClose = useCallback(() => {
    alertResolveRef.current?.();
    alertResolveRef.current = null;
    setPendingAlert(null);
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {pendingConfirm && (
        <ConfirmDialog
          options={pendingConfirm.options}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
      {pendingAlert && (
        <AlertNoticeDialog
          options={pendingAlert.options}
          onClose={handleAlertClose}
        />
      )}
    </DialogContext.Provider>
  );
}
