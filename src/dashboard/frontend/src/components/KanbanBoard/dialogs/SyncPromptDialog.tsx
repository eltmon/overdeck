import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Issue } from '../../../types';

interface SyncPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSync: (syncToTracker: boolean, options?: { cleanupWorkspace?: boolean; stopAgents?: boolean }) => void;
  issue: Issue | null;
}

export function SyncPromptDialog({ isOpen, onClose, onSync, issue }: SyncPromptDialogProps) {
  const [cleanupWorkspace, setCleanupWorkspace] = useState(false);
  const [stopAgents, setStopAgents] = useState(false);

  if (!isOpen || !issue) return null;

  // Determine tracker type from issue source
  const trackerName = issue.source === 'github' ? 'GitHub' : 'Linear';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="p-2 badge-bg-success rounded-lg">
            <Check className="w-6 h-6 text-success-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Move to Done
            </h3>
            <p className="text-foreground text-sm mb-4">
              You're moving <strong>{issue.identifier}</strong> to Done.
            </p>

            {/* Cleanup options */}
            <div className="space-y-2 mb-4 p-3 bg-popover/50 rounded-lg">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleanupWorkspace}
                  onChange={(e) => setCleanupWorkspace(e.target.checked)}
                  className="rounded border-border bg-popover text-success focus:ring-ring"
                />
                Clean up workspace
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={stopAgents}
                  onChange={(e) => setStopAgents(e.target.checked)}
                  className="rounded border-border bg-popover text-success focus:ring-ring"
                />
                Stop running agents
              </label>
            </div>

            <p className="text-muted-foreground text-xs mb-4">
              Sync status change to {trackerName}?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => onSync(false, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
              >
                Shadow Only
              </button>
              <button
                onClick={() => onSync(true, { cleanupWorkspace, stopAgents })}
                className="px-4 py-2 bg-success hover:bg-success/90 text-foreground rounded-lg transition-colors text-sm"
              >
                Sync to {trackerName}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
