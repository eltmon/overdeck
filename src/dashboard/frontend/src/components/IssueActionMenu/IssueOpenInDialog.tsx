import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import { PanOpenInPicker } from '../PanOpenInPicker';

interface IssueOpenInDialogProps {
  cwd: string;
  onClose: () => void;
}

export function IssueOpenInDialog({ cwd, onClose }: IssueOpenInDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Open workspace"
        className="min-w-[260px] rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Open workspace</h3>
          <button ref={closeRef} type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <PanOpenInPicker openInCwd={cwd} />
      </div>
    </div>
  );
}
