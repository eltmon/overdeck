/**
 * "Set up a new vault" form and the shown-once recovery dialog (PAN-4446 WI-7).
 *
 * Posts to `POST /api/vault/setup`. The recovery phrase and a generated
 * passphrase come back once and live in this component's state only (D-11):
 * no query cache, no toast, no storage. The dialog closes only after the
 * operator checks "I wrote it down".
 */
import { useState } from 'react';
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

interface ShownOnce {
  recoveryPhrase: string;
  generated: string | null;
  passphraseError: string | null;
}

function RecoveryDialog({ secrets, onDone }: { secrets: ShownOnce; onDone: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const closeIfAcknowledged = () => {
    if (acknowledged) onDone();
  };
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={closeIfAcknowledged}
      onKeyDown={(e) => { if (e.key === 'Escape') closeIfAcknowledged(); }}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-recovery-title"
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 id="vault-recovery-title" className="text-base font-semibold text-foreground">Write down your recovery phrase</h3>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <p className="text-foreground">It is shown only now. A new machine can join with it, or with the passphrase.</p>
          <textarea
            readOnly
            rows={4}
            data-testid="vault-recovery-phrase"
            value={secrets.recoveryPhrase}
            className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
            onFocus={(e) => e.target.select()}
          />
          {secrets.generated && (
            <label className="block">
              <span className="text-xs text-muted-foreground">Vault passphrase (shown only now)</span>
              <input
                type="text"
                readOnly
                data-testid="vault-generated-passphrase"
                value={secrets.generated}
                className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {secrets.passphraseError && (
            <p className="text-xs text-destructive">
              Could not store the passphrase: {secrets.passphraseError}. Join with the recovery phrase, or run: pan vault passphrase set
            </p>
          )}
          <p className="text-xs text-muted-foreground">{VAULT_SECRET_WARNING}</p>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            I wrote it down
          </label>
        </div>
        <div className="flex items-center justify-end px-4 py-3 border-t border-border">
          <button
            type="button"
            disabled={!acknowledged}
            onClick={onDone}
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function SessionVaultSetupForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [choice, setChoice] = useState<PassphraseChoice>('generate');
  const [custom, setCustom] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [shownOnce, setShownOnce] = useState<ShownOnce | null>(null);

  const customTooShort = choice === 'custom' && custom.length < PASSPHRASE_MIN_LENGTH;
  const canSubmit = url.trim() !== '' && !customTooShort && !running;

  const handleSubmit = async () => {
    setRunning(true);
    setError(null);
    setNotice(null);
    const passphrase = choice === 'custom' ? { mode: 'custom', value: custom } : { mode: choice };
    try {
      const { status, body } = await postVault('setup', { url: url.trim(), passphrase });
      const result = body as SetupResponse | null;
      if (status === 200 && result?.status === 'already-set-up') {
        setNotice('This machine is already set up with this vault.');
        onDone();
      } else if (status === 200 && result?.status === 'created') {
        setCustom('');
        if (result.recoveryPhrase) {
          setShownOnce({
            recoveryPhrase: result.recoveryPhrase,
            generated: result.passphrase?.stored ? result.passphrase.generated ?? null : null,
            passphraseError: result.passphrase && !result.passphrase.stored ? result.passphrase.error ?? null : null,
          });
        } else {
          setNotice("Set up with this machine's existing vault key. Its recovery phrase was shown when the key was created.");
          onDone();
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

  const handleDone = () => {
    setShownOnce(null);
    onDone();
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
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {shownOnce && <RecoveryDialog secrets={shownOnce} onDone={handleDone} />}
    </div>
  );
}
