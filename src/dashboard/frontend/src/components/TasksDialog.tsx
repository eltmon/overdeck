import { List, X } from 'lucide-react';
import { TasksPanel } from './TasksPanel';

interface TasksDialogProps {
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function TasksDialog({ issueId, isOpen, onClose }: TasksDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-dialog-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-success" />
            <h2 id="tasks-dialog-title" className="font-medium text-foreground">Tasks: {issueId}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
            aria-label="Close tasks viewer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <TasksPanel issueId={issueId} />
        </div>
      </div>
    </div>
  );
}
