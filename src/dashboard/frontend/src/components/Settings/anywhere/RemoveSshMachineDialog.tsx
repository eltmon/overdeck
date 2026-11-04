/**
 * Remove an SSH machine (PAN-4404 FR-5). For a server this dashboard started
 * (`managed`), removal stops it unless the operator ticks "Leave the server
 * running"; a server that was already running (`external`) is never stopped.
 * The shared confirm dialog has no checkbox, so this is its own small modal.
 */
import { useState } from 'react';

import type { MachineLinkView, SshLinkInfo } from './machinesApi';

interface RemoveSshMachineDialogProps {
  link: MachineLinkView & { ssh: SshLinkInfo };
  onCancel: () => void;
  onConfirm: (keepServer: boolean) => void;
}

export function RemoveSshMachineDialog({ link, onCancel, onConfirm }: RemoveSshMachineDialogProps) {
  const [keepServer, setKeepServer] = useState(false);
  const managed = link.ssh.launch === 'managed';
  const destination = link.ssh.destination;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4 p-4 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-ssh-machine-title"
        data-component="remove-ssh-machine-dialog"
      >
        <h3 id="remove-ssh-machine-title" className="text-base font-medium text-foreground">Remove {link.label}?</h3>
        <p className="text-sm text-foreground">
          This machine loses access to {link.label}, and {link.label} is told to drop its access here.
        </p>
        {managed ? (
          <>
            <p className="text-sm text-foreground">Overdeck started the server on {destination}. Removing this machine stops that server.</p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={keepServer} onChange={(e) => setKeepServer(e.target.checked)} className="mt-0.5 shrink-0 accent-primary" />
              <span className="text-sm text-foreground">Leave the server running</span>
            </label>
          </>
        ) : (
          <p className="text-sm text-foreground">The server on {destination} keeps running.</p>
        )}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(managed && keepServer)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
