/**
 * Link a machine (PAN-4645 FR-1, FR-4): paste the pairing link another
 * dashboard printed, pick the access level, and link one way or both ways.
 * Three fields, so a modal (page-not-modal doctrine allows 4 or fewer).
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Modal } from '../../shared/Modal';
import { ANYWHERE_STATUS_QUERY_KEY, isOk } from './anywhereApi';
import styles from './anywhereDialog.module.css';
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

  return (
    <Modal
      title="Link a machine"
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void handleLink();
      }}
      pinned={error ? <p className={styles.error} role="alert">{error}</p> : null}
      footer={<>
        <button type="button" onClick={onClose} className={styles.button}>
          Cancel
        </button>
        <button type="submit" disabled={pairingUrl.trim() === '' || linking} className={styles.primaryButton}>
          {linking ? 'Linking…' : 'Link'}
        </button>
      </>}
    >
      <div className={styles.form} data-component="link-machine-dialog">
        <div className={styles.field}>
          <label htmlFor="link-machine-url" className={styles.label}>Pairing link from the other machine</label>
          <input
            id="link-machine-url"
            type="text"
            placeholder="https://desk.tailnet.ts.net/#pair=…"
            value={pairingUrl}
            onChange={(e) => {
              setPairingUrl(e.target.value);
              setError(null);
            }}
            className={`${styles.input} ${styles.mono}`}
          />
          <p className={styles.hint}>
            Run <code>pan pair</code> on the other machine, or open its Settings → Anywhere → Pair a device, and paste the link here.
          </p>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={`${styles.label} mb-2.5`}>Access</legend>
          <label className={styles.choice}>
            <input type="radio" name="link-machine-access" value="operator" checked={access === 'operator'} onChange={() => setAccess('operator')} />
            <span className="min-w-0">
              <span className={styles.choiceTitle}>Operator-level</span>
              <span className={styles.choiceHint}>{OPERATOR_ACCESS_TEXT}</span>
            </span>
          </label>
          <label className={styles.choice}>
            <input type="radio" name="link-machine-access" value="agent-fenced" checked={access === 'agent-fenced'} onChange={() => setAccess('agent-fenced')} />
            <span className="min-w-0">
              <span className={styles.choiceTitle}>Agent-fenced</span>
              <span className={styles.choiceHint}>{AGENT_FENCED_ACCESS_TEXT}</span>
            </span>
          </label>
        </fieldset>

        <label className={styles.choice}>
          <input type="checkbox" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} />
          <span className="min-w-0">
            <span className={styles.choiceTitle}>Link both ways</span>
            <span className={styles.choiceHint}>The other machine gets the same access to this one, so either dashboard can show both.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
