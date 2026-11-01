/**
 * The Machine field of the new-conversation dialog (PAN-4651 FR-1, FR-7,
 * D-4651-23): this machine (the default), Auto, each online and visible linked
 * machine by label, and "Fly (new VM)" shown disabled until PAN-4652. Choosing
 * Auto reveals a Needs input: comma-separated capability tags every candidate
 * must have. Machine labels are muted text, never a badge.
 */
import { useQuery } from '@tanstack/react-query';

import { loadMachines, MACHINES_QUERY_KEY } from '../Settings/anywhere/machinesApi';
import styles from './NewConversationDialog.module.css';

/** `machine` is '' for this machine, 'auto', or a linked machine's environment id. */
export interface MachineChoice {
  machine: string;
  needs: string;
}

export const THIS_MACHINE: MachineChoice = { machine: '', needs: '' };

/** Comma-separated tags as the fleet route takes them. */
export function parseNeedsInput(text: string): string[] {
  return [...new Set(text.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))];
}

export function MachineField({ value, onChange }: { value: MachineChoice; onChange: (next: MachineChoice) => void }) {
  const { data } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, staleTime: 15_000 });
  const links = (data?.links ?? []).filter((link) => link.state === 'online' && link.hidden !== true);
  const selfLabel = data?.self.label;

  return (
    <>
      <label className={styles.row}>
        <span className={styles.label}>Machine</span>
        <select
          aria-label="Machine"
          className={styles.control}
          value={value.machine}
          onChange={(event) => onChange({ machine: event.target.value, needs: event.target.value === 'auto' ? value.needs : '' })}
        >
          <option value="">{selfLabel ? `This machine (${selfLabel})` : 'This machine'}</option>
          <option value="auto">Auto</option>
          {links.map((link) => <option key={link.id} value={link.environmentId}>{link.label}</option>)}
          <option value="fly" disabled title="Needs PAN-4652">Fly (new VM)</option>
        </select>
      </label>
      {value.machine === 'auto' && (
        <label className={styles.row}>
          <span className={styles.label}>Needs</span>
          <input
            aria-label="Needs"
            className={styles.control}
            placeholder="docker, gpu"
            value={value.needs}
            onChange={(event) => onChange({ ...value, needs: event.target.value })}
          />
        </label>
      )}
    </>
  );
}
