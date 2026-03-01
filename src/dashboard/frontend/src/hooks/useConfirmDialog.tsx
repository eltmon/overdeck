import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';

interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  icon?: 'warning' | 'info';
}

interface PromptDialogOptions extends ConfirmDialogOptions {
  placeholder?: string;
  defaultValue?: string;
}

interface DialogState {
  type: 'confirm' | 'alert' | 'prompt';
  options: ConfirmDialogOptions & { placeholder?: string; defaultValue?: string };
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  alert: (options: Omit<ConfirmDialogOptions, 'cancelLabel'>) => Promise<void>;
  prompt: (options: PromptDialogOptions) => Promise<string | null>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

export function useConfirmDialog(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  }
  return ctx;
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const resolveRef = useRef<((value: boolean | string | null) => void) | null>(null);

  const dismissPending = useCallback(() => {
    if (resolveRef.current) {
      resolveRef.current(false);
      resolveRef.current = null;
    }
  }, []);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    dismissPending();
    return new Promise((resolve) => {
      resolveRef.current = resolve as (value: boolean | string | null) => void;
      setDialog({ type: 'confirm', options });
    });
  }, [dismissPending]);

  const alert = useCallback((options: Omit<ConfirmDialogOptions, 'cancelLabel'>): Promise<void> => {
    dismissPending();
    return new Promise((resolve) => {
      resolveRef.current = () => resolve();
      setDialog({ type: 'alert', options: { ...options, cancelLabel: undefined } });
    });
  }, [dismissPending]);

  const prompt = useCallback((options: PromptDialogOptions): Promise<string | null> => {
    dismissPending();
    return new Promise((resolve) => {
      resolveRef.current = resolve as (value: boolean | string | null) => void;
      setPromptValue(options.defaultValue ?? '');
      setDialog({ type: 'prompt', options });
    });
  }, [dismissPending]);

  const handleConfirm = useCallback(() => {
    if (dialog?.type === 'prompt') {
      resolveRef.current?.(promptValue);
    } else {
      resolveRef.current?.(true);
    }
    setDialog(null);
    resolveRef.current = null;
  }, [dialog, promptValue]);

  const handleCancel = useCallback(() => {
    if (dialog?.type === 'prompt') {
      resolveRef.current?.(null);
    } else if (dialog?.type === 'alert') {
      resolveRef.current?.(true);
    } else {
      resolveRef.current?.(false);
    }
    setDialog(null);
    resolveRef.current = null;
  }, [dialog]);

  const IconComponent = dialog?.options.icon === 'info' ? Info : AlertTriangle;
  const iconColor = dialog?.options.icon === 'info' ? 'text-blue-400' : 'text-orange-400';

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      <AlertDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        {dialog && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-2">
                <IconComponent className={`w-5 h-5 ${iconColor} shrink-0`} />
                <AlertDialogTitle>{dialog.options.title}</AlertDialogTitle>
              </div>
            </AlertDialogHeader>

            <div className="px-4 py-3 space-y-3">
              <AlertDialogDescription className="whitespace-pre-line">
                {dialog.options.description}
              </AlertDialogDescription>

              {dialog.type === 'prompt' && (
                <input
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={dialog.options.placeholder}
                  className="w-full px-3 py-2 rounded border border-divider bg-input-bg text-content text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirm();
                  }}
                />
              )}
            </div>

            <AlertDialogFooter>
              {dialog.type !== 'alert' && (
                <AlertDialogCancel>
                  {dialog.options.cancelLabel ?? 'Cancel'}
                </AlertDialogCancel>
              )}
              <AlertDialogAction
                variant={dialog.options.variant ?? 'default'}
                onClick={handleConfirm}
              >
                {dialog.options.confirmLabel ?? 'OK'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  );
}
