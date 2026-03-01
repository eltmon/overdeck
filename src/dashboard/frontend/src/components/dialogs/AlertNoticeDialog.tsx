import { useEffect, useRef } from 'react';
import { Info, CheckCircle, AlertTriangle, XCircle, X } from 'lucide-react';

export interface AlertDialogOptions {
  title?: string;
  message: string;
  okLabel?: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
}

interface AlertNoticeDialogProps {
  options: AlertDialogOptions;
  onClose: () => void;
}

const variantConfig = {
  info: { icon: Info, color: 'text-blue-400' },
  success: { icon: CheckCircle, color: 'text-green-400' },
  warning: { icon: AlertTriangle, color: 'text-orange-400' },
  error: { icon: XCircle, color: 'text-red-400' },
};

export function AlertNoticeDialog({ options, onClose }: AlertNoticeDialogProps) {
  const okRef = useRef<HTMLButtonElement>(null);

  const {
    title = 'Notice',
    message,
    okLabel = 'OK',
    variant = 'info',
  } = options;

  const { icon: Icon, color } = variantConfig[variant];

  useEffect(() => {
    okRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-message"
        className="bg-surface-raised border border-divider rounded-lg shadow-2xl w-full max-w-md mx-4 animate-fade-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${color}`} />
            <h3 id="alert-dialog-title" className="text-lg font-semibold text-content">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-content-subtle hover:text-content-body transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div id="alert-dialog-message" className="p-4">
          <p className="text-sm text-content-body whitespace-pre-line">{message}</p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 py-3 border-t border-divider bg-surface/30">
          <button
            ref={okRef}
            onClick={onClose}
            className="px-4 py-2 rounded text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors font-medium"
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
