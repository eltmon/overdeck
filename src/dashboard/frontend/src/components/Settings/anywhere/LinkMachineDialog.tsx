/**
 * Link a machine (PAN-4645 FR-1, FR-4): paste the pairing link another
 * dashboard printed, pick the access level, and link one way or both ways.
 * Three fields, so a modal (page-not-modal doctrine allows 4 or fewer).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';

import { ANYWHERE_STATUS_QUERY_KEY, isOk } from './anywhereApi';
import { type LinkAccess, linkErrorText, linkMachine, MACHINES_QUERY_KEY } from './machinesApi';

interface LinkMachineDialogProps {
  open: boolean;
  onClose: () => void;
}

export const OPERATOR_ACCESS_TEXT =
  'This machine can read and control the other machine\'s conversations, but can never pair devices, mint tokens or change its settings.';
export const AGENT_FENCED_ACCESS_TEXT =
  'Only what agents on this machine may do within their own scopes; no operator-level control of the other machine.';

export function LinkMachineDialog({ open, onClose }: LinkMachineDialogProps) {
  if (!open) return null;
  return <LinkMachineDialogBody onClose={onClose} />;
}

function LinkMachineDialogBody({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [pairingUrl, setPairingUrl] = useState('');
  const [access, setAccess] = useState<LinkAccess>('operator');
  const [bothWays, setBothWays] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLink = async () => {
    const trimmed = pairingUrl.trim();
    if (trimmed === '') return;
    setLinking(true);
    setError(null);
    try {
      const result = await linkMachine({ pairingUrl: trimmed, bothWays, access });
      if (!isOk(result)) {
        setError(linkErrorText(result));
        return;
      }
      toast.success(`Linked ${result.body.label}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MACHINES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY }),
      ]);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinking(false);
    }
  };

  const radioClass = 'mt-0.5 shrink-0 accent-primary';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-machine-title"
        data-component="link-machine-dialog"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 id="link-machine-title" className="text-base font-medium text-foreground">Link a machine</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          className="p-4 space-y-4 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleLink();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="link-machine-url" className="text-xs text-muted-foreground">Pairing link from the other machine</label>
            <input
              id="link-machine-url"
              type="text"
              autoFocus
              placeholder="https://desk.tailnet.ts.net/#pair=…"
              value={pairingUrl}
              onChange={(e) => {
                setPairingUrl(e.target.value);
                setError(null);
              }}
              className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono focus:ring-1 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Run <code className="font-mono">pan pair</code> on the other machine, or open its Settings → Anywhere → Pair a device, and paste the link here.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">Access</legend>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="link-machine-access" value="operator" checked={access === 'operator'} onChange={() => setAccess('operator')} className={radioClass} />
              <span className="min-w-0">
                <span className="text-sm text-foreground">Operator-level</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{OPERATOR_ACCESS_TEXT}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="link-machine-access" value="agent-fenced" checked={access === 'agent-fenced'} onChange={() => setAccess('agent-fenced')} className={radioClass} />
              <span className="min-w-0">
                <span className="text-sm text-foreground">Agent-fenced</span>
                <span className="block text-xs text-muted-foreground mt-0.5">{AGENT_FENCED_ACCESS_TEXT}</span>
              </span>
            </label>
          </fieldset>

          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} className="mt-0.5 shrink-0 accent-primary" />
            <span className="min-w-0">
              <span className="text-sm text-foreground">Link both ways</span>
              <span className="block text-xs text-muted-foreground mt-0.5">The other machine gets the same access to this one, so either dashboard can show both.</span>
            </span>
          </label>

          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pairingUrl.trim() === '' || linking}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {linking ? 'Linking…' : 'Link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
