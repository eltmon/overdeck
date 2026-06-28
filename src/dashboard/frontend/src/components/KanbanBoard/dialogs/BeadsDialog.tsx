import { List, X } from 'lucide-react';
import type { Issue } from '../../../types';
import { BeadsTasksPanel } from '../../BeadsTasksPanel';

// Simple Beads Dialog component
export function BeadsDialog({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-success-foreground" />
            <h2 className="font-semibold text-foreground">Tasks: {issue.identifier}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-popover rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BeadsTasksPanel with list/graph toggle */}
        <div className="flex-1 overflow-hidden">
          <BeadsTasksPanel issueId={issue.identifier} />
        </div>
      </div>
    </div>
  );
}
