import { type FormEvent } from 'react';

export type SwarmDispatchDialogProps = {
  issueId: string;
  onClose: () => void;
  onDispatch: () => void;
  pending?: boolean;
};

export function SwarmDispatchDialog({ issueId, onClose, onDispatch, pending = false }: SwarmDispatchDialogProps) {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    onDispatch();
    onClose();
  };

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <p className="text-xs text-muted-foreground">
        Dispatch a parallel swarm for {issueId} using the planned beads.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}>Cancel</button>
        <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? 'Dispatching…' : 'Dispatch swarm'}
        </button>
      </div>
    </form>
  );
}
