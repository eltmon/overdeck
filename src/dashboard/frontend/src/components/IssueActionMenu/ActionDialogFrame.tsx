import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * The modal shell every issue-action dialog renders inside.
 *
 * It lives in its own module rather than in IssueActionMenu.tsx so that a dialog
 * in its own file can use it without importing the menu that renders the dialog
 * — that import pair is a cycle, and `npm run lint:circular` rejects it
 * (PAN-4198, added with RestartAgentDialog).
 */
export type ActionDialogFrameProps = {
  label: string;
  onClose: () => void;
  children: ReactNode;
};

export function ActionDialogFrame({ label, onClose, children }: ActionDialogFrameProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label}
        className="w-full max-w-md rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-medium">{label}</h3>
          <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
