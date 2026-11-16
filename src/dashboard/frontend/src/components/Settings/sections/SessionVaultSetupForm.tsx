/**
 * "Set up a new vault" form and the shown-once recovery dialog (PAN-4446 WI-7).
 *
 * Posts to `POST /api/vault/setup`. The recovery phrase and a generated
 * passphrase come back once and are handed to the section through
 * `onCreated`; they live in React state only (D-11): no query cache, no toast,
 * no storage. The section renders `RecoveryDialog` outside its state-dependent
 * branch, because the next status refetch reports `ready` and unmounts this
 * form. The dialog closes only after the operator checks "I wrote it down".
 */
import { useState } from 'react';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import { BUTTON_CLASS, INPUT_CLASS, postVault, vaultErrorMessage } from './sessionVaultShared';

type PassphraseChoice = 'generate' | 'custom' | 'none';

const PASSPHRASE_MIN_LENGTH = 16;

export const VAULT_SECRET_WARNING =
  'Neither the passphrase nor the recovery phrase can be recovered. Anyone with either can read your vault. Losing every device and both of them loses the vault.';

/** D-9: setup refusals whose CLI text says "Run: pan vault join" point at the join form instead. */
const JOIN_INSTEAD_CODES = new Set(['foreign-vault', 'race-lost']);
const JOIN_INSTEAD_MESSAGE = 'This remote already holds a vault. Use “Join an existing vault” below.';

interface SetupResponse {
  status: 'created' | 'already-set-up' | 'error';
  code?: string;
  message?: string;
  recoveryPhrase?: string | null;
  passphrase?: { stored: boolean; generated?: string | null; error?: string | null };
}

export interface ShownOnce {
  recoveryPhrase: string;
  generated: string | null;
  passphraseError: string | null;
}

export function RecoveryDialog({ secrets, onDone }: { secrets: ShownOnce; onDone: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Modal
      title="Write down your recovery phrase"
      size="narrow"
      onClose={onDone}
      dismissible={acknowledged}
      footer={
        <button type="button" disabled={!acknowledged} onClick={onDone} className={formStyles.primaryButton}>
          Done
        </button>
      }
    >
      <div className={formStyles.form}>
        <div className={formStyles.field}>
          <p className={formStyles.text}>It is shown only now. A new machine can join with it, or with the passphrase.</p>
          <textarea
            readOnly
            rows={4}
            data-testid="vault-recovery-phrase"
            value={secrets.recoveryPhrase}
            className={`${formStyles.textarea} ${formStyles.mono}`}
            onFocus={(e) => e.target.select()}
          />
        </div>
        {secrets.generated && (
          <label className={formStyles.field}>
            <span className={formStyles.label}>Vault passphrase (shown only now)</span>
            <input
              type="text"
              readOnly
              data-testid="vault-generated-passphrase"
              value={secrets.generated}
              className={`${formStyles.input} ${formStyles.mono}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        {secrets.passphraseError && (
          <p className={formStyles.error}>
            Could not store the passphrase: {secrets.passphraseError}. Join with the recovery phrase, or run: pan vault passphrase set
          </p>
        )}
        <p className={formStyles.hint}>{VAULT_SECRET_WARNING}</p>
        <label className={formStyles.choice}>
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          <span className={formStyles.choiceTitle}>I wrote it down</span>
        </label>
      </div>
    </Modal>
  );
}

/**
 * `onDone` receives a line for the section to show when there is one; a setup changes the state and unmounts this form.
 * `onCreated` receives the shown-once secrets of a new vault; the section owns the dialog that shows them.
 */
export function SessionVaultSetupForm({ onDone, onCreated }: { onDone: (message?: string) => void; onCreated: (secrets: ShownOnce) => void }) {
  const [url, setUrl] = useState('');
  const [choice, setChoice] = useState<PassphraseChoice>('generate');
  const [custom, setCustom] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customTooShort = choice === 'custom' && custom.length < PASSPHRASE_MIN_LENGTH;
  const canSubmit = url.trim() !== '' && !customTooShort && !running;

  const handleSubmit = async () => {
    setRunning(true);
    setError(null);
    const passphrase = choice === 'custom' ? { mode: 'custom', value: custom } : { mode: choice };
    try {
      const { status, body } = await postVault('setup', { url: url.trim(), passphrase });
      const result = body as SetupResponse | null;
      if (status === 200 && result?.status === 'already-set-up') {
        onDone('This machine is already set up with this vault.');
      } else if (status === 200 && result?.status === 'created') {
        setCustom('');
        if (result.recoveryPhrase) {
          onCreated({
            recoveryPhrase: result.recoveryPhrase,
            generated: result.passphrase?.stored ? result.passphrase.generated ?? null : null,
            passphraseError: result.passphrase && !result.passphrase.stored ? result.passphrase.error ?? null : null,
          });
        } else {
          onDone("Set up with this machine's existing vault key. Its recovery phrase was shown when the key was created.");
        }
      } else if (status === 422 && result?.code && JOIN_INSTEAD_CODES.has(result.code)) {
        setError(JOIN_INSTEAD_MESSAGE);
      } else {
        setError(vaultErrorMessage(body, `Setting up the vault failed (${status}).`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">Set up a new vault</h3>
      <label className="block">
        <span className="text-xs text-muted-foreground">Git URL</span>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@github.com:you/overdeck-vault.git"
          className={INPUT_CLASS}
        />
      </label>
      <fieldset className="space-y-1 text-xs">
        <legend className="text-muted-foreground mb-1">Passphrase for joining new machines</legend>
        <label className="flex items-center gap-2 text-foreground">
          <input type="radio" name="vault-passphrase" checked={choice === 'generate'} onChange={() => setChoice('generate')} />
          Suggested (generated for you)
        </label>
        <label className="flex items-center gap-2 text-foreground">
          <input type="radio" name="vault-passphrase" checked={choice === 'custom'} onChange={() => setChoice('custom')} />
          My own
        </label>
        {choice === 'custom' && (
          <label className="block pl-5">
            <span className="text-muted-foreground">Passphrase (16+ characters)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-foreground">
          <input type="radio" name="vault-passphrase" checked={choice === 'none'} onChange={() => setChoice('none')} />
          None
        </label>
      </fieldset>
      <p className="text-xs text-muted-foreground">{VAULT_SECRET_WARNING}</p>
      <button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()} className={BUTTON_CLASS}>
        {running ? 'Setting up…' : 'Set up vault'}
      </button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
