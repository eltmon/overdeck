import { Undo, X } from 'lucide-react';

interface UndoToastProps {
  isVisible: boolean;
  onUndo: () => void;
  onClose: () => void;
}

export function UndoToast({ isVisible, onUndo, onClose }: UndoToastProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl px-4 py-3 flex items-center gap-4">
        <span className="text-sm text-foreground">Issue moved</span>
        <button
          onClick={onUndo}
          className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <Undo className="w-4 h-4" />
          Undo
        </button>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-muted-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
