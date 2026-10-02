/**
 * "Join an existing vault" / "Unlock this machine" form (PAN-4446 WI-8).
 *
 * Posts to `POST /api/vault/join` with the passphrase or the 24-word recovery
 * phrase. Unlock is the same operation for a machine whose backend is set but
 * whose key is missing or was retired by a rotation; its URL is the configured
 * backend and cannot be edited. The secret lives in component state only and
 * is cleared after a successful join.
 */
import { useState } from 'react';
import { BUTTON_CLASS, INPUT_CLASS, postVault, vaultErrorMessage } from './sessionVaultShared';

type SecretKind = 'passphrase' | 'phrase';

/** D-9: a remote that is not a vault yet points at the setup form instead of the CLI. */
const SETUP_INSTEAD_MESSAGE = 'This remote is not a Session Vault yet. Use “Set up a new vault” above.';

interface JoinResponse {
  status: 'joined' | 'error';
  code?: string;
  message?: string;
  machine?: { label: string };
  records?: number;
  offline?: boolean;
}

/** `onDone` receives the success line; the section shows it, since a join changes the state and unmounts this form. */
export function SessionVaultJoinForm({ mode, backend, onDone }: { mode: 'join' | 'unlock'; backend: string | null; onDone: (message: string) => void }) {
  const [url, setUrl] = useState(mode === 'unlock' ? backend ?? '' : '');
  const [kind, setKind] = useState<SecretKind>('passphrase');
  const [secret, setSecret] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = mode === 'unlock' ? 'Unlock' : 'Join';
  const canSubmit = url.trim() !== '' && secret.trim() !== '' && !running;

  const switchKind = (next: SecretKind) => {
    setKind(next);
    setSecret('');
  };

  const handleSubmit = async () => {
    setRunning(true);
    setError(null);
    try {
      const { status, body } = await postVault('join', { url: url.trim(), secret: { kind, value: secret } });
      const result = body as JoinResponse | null;
      if (status === 200 && result?.status === 'joined') {
        setSecret('');
        onDone(result.offline
          ? `Joined as ${result.machine?.label}. The backend was unreachable; sync later.`
          : `Joined as ${result.machine?.label}. ${result.records ?? 0} saved conversation(s) listed.`);
      } else if (status === 422 && result?.code === 'not-a-vault') {
        setError(SETUP_INSTEAD_MESSAGE);
      } else {
        setError(vaultErrorMessage(body, `${action} failed (${status}).`));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">{mode === 'unlock' ? 'Unlock this machine' : 'Join an existing vault'}</h3>
      {mode === 'unlock' && (
        <p className="text-xs text-muted-foreground">
          This machine is set up for this vault but its key is missing or was replaced by a key rotation. Enter the passphrase or the recovery phrase to unlock it.
        </p>
      )}
      <label className="block">
        <span className="text-xs text-muted-foreground">Git URL</span>
        <input
          type="text"
          value={url}
          readOnly={mode === 'unlock'}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="git@github.com:you/overdeck-vault.git"
          className={INPUT_CLASS}
        />
      </label>
      {kind === 'passphrase' ? (
        <label className="block">
          <span className="text-xs text-muted-foreground">Passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      ) : (
        <label className="block">
          <span className="text-xs text-muted-foreground">Recovery phrase (24 words)</span>
          <textarea
            rows={3}
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={`${INPUT_CLASS} font-mono`}
          />
        </label>
      )}
      <button
        type="button"
        onClick={() => switchKind(kind === 'passphrase' ? 'phrase' : 'passphrase')}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        {kind === 'passphrase' ? 'Use the recovery phrase instead' : 'Use the passphrase instead'}
      </button>
      <div>
        <button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()} className={BUTTON_CLASS}>
          {running ? `${action}ing…` : action}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
