/**
 * The Machine field of the new-conversation dialog (PAN-4651 FR-1, FR-7,
 * D-4651-23): this machine (the default), Auto, each online and visible linked
 * machine by label, and "Fly (new VM)" (PAN-4743), enabled only when the
 * dialog has a project. Choosing Auto reveals a Needs input: comma-separated
 * capability tags every candidate must have. Machine labels are muted text,
 * never a badge.
 */
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

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

export function MachineField({ value, onChange, hasProject }: { value: MachineChoice; onChange: (next: MachineChoice) => void; hasProject: boolean }) {
  const { data } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, staleTime: 15_000 });
  const links = (data?.links ?? []).filter((link) => link.state === 'online' && link.hidden !== true);
  const selfLabel = data?.self.label;
  const machineId = useId();
  const needsId = useId();

  return (
    <>
      <label htmlFor={machineId} className={styles.label}>Machine</label>
      <div className={styles.field}>
        <select
          id={machineId}
          aria-label="Machine"
          className={styles.select}
          value={value.machine}
          onChange={(event) => onChange({ machine: event.target.value, needs: event.target.value === 'auto' ? value.needs : '' })}
        >
          <option value="">{selfLabel ? `This machine (${selfLabel})` : 'This machine'}</option>
          <option value="auto">Auto</option>
          {links.map((link) => <option key={link.id} value={link.environmentId}>{link.label}</option>)}
          <option value="fly" disabled={!hasProject} title={hasProject ? 'Starts a new Fly machine, clones the project and runs the conversation there' : 'Fly (new VM) needs a project'}>Fly (new VM)</option>
        </select>
        <ChevronDown size={14} className={styles.chev} />
      </div>
      {value.machine === 'auto' && (
        <>
          <label htmlFor={needsId} className={styles.label}>Needs</label>
          <div className={styles.field}>
            <input
              id={needsId}
              aria-label="Needs"
              className={styles.input}
              placeholder="docker, gpu"
              value={value.needs}
              onChange={(event) => onChange({ ...value, needs: event.target.value })}
            />
          </div>
        </>
      )}
    </>
  );
}
