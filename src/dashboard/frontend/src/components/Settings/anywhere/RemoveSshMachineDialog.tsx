/**
 * Remove an SSH machine (PAN-4404 FR-5). For a server this dashboard started
 * (`managed`), removal stops it unless the operator ticks "Leave the server
 * running"; a server that was already running (`external`) is never stopped.
 * The shared confirm dialog has no checkbox, so this is its own small modal.
 */
import { useState } from 'react';

import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
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
    <Modal
      title={`Remove ${link.label}?`}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={formStyles.button}>
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(managed && keepServer)} className={formStyles.destructiveButton}>
            Remove
          </button>
        </>
      }
    >
      <div className={formStyles.form} data-component="remove-ssh-machine-dialog">
        <p className={formStyles.text}>
          This machine loses access to {link.label}, and {link.label} is told to drop its access here.
        </p>
        {managed ? (
          <>
            <p className={formStyles.text}>Overdeck started the server on {destination}. Removing this machine stops that server.</p>
            <label className={formStyles.choice}>
              <input type="checkbox" checked={keepServer} onChange={(e) => setKeepServer(e.target.checked)} />
              <span className={formStyles.choiceTitle}>Leave the server running</span>
            </label>
          </>
        ) : (
          <p className={formStyles.text}>The server on {destination} keeps running.</p>
        )}
      </div>
    </Modal>
  );
}
