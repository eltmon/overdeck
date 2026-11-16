import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
import { Modal } from '../../shared/Modal';
import formStyles from '../../shared/ModalForm.module.css';
import { ACCESS_TOKEN_SCOPE_OPTIONS } from './accessTokenScopes';
import {
  ACCESS_TOKENS_FORBIDDEN_EXPLANATION,
  AccessTokensForbiddenError,
  throwForAccessTokensResponse,
  type AccessTokenRecord,
} from './accessTokensShared';

interface CreateAccessTokenDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface CreatedToken {
  token: string;
  record: AccessTokenRecord;
}

async function createAccessToken(name: string, scopes: string[]): Promise<CreatedToken> {
  await ensureDashboardSession();
  const res = await fetch('/api/access-tokens', {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ name, scopes }),
  });
  if (!res.ok) return throwForAccessTokensResponse(res, `Failed to create access token (${res.status})`);
  return res.json();
}

export function CreateAccessTokenDialog({ open, onClose, onCreated }: CreateAccessTokenDialogProps) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createAccessToken(name.trim(), scopes),
    onSuccess: () => {
      onCreated();
    },
  });

  if (!open) return null;

  const reset = () => {
    setName('');
    setScopes([]);
    setCopied(false);
    mutation.reset();
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const toggleScope = (id: string) => {
    setScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  };

  const canCreate = name.trim() !== '' && scopes.length > 0;
  const created = mutation.data ?? null;
  const forbidden = mutation.error instanceof AccessTokensForbiddenError ? mutation.error : null;
  const otherError = mutation.error && !forbidden ? mutation.error : null;

  const handleCopy = () => {
    if (!created) return;
    void navigator.clipboard.writeText(created.token).then(() => setCopied(true));
  };

  return (
    <Modal
      title="Create access token"
      size="narrow"
      onClose={handleClose}
      footer={created ? undefined : (
        <>
          <button type="button" onClick={handleClose} className={formStyles.button}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canCreate || mutation.isPending}
            className={formStyles.primaryButton}
          >
            Create
          </button>
        </>
      )}
    >
      <div className={formStyles.form}>
        {created ? (
          <div className={formStyles.field}>
            <p className={formStyles.text}>Copy this token now. It is not shown again.</p>
            <input
              type="text"
              readOnly
              data-testid="access-token-plaintext"
              value={created.token}
              className={`${formStyles.input} ${formStyles.mono}`}
              onFocus={(e) => e.target.select()}
            />
            <div>
              <button type="button" onClick={handleCopy} className={formStyles.button}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className={formStyles.field}>
              <span className={formStyles.label}>Name</span>
              <input
                type="text"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={formStyles.input}
              />
            </label>
            <div className={formStyles.field}>
              <span className={formStyles.label}>Scopes</span>
              {ACCESS_TOKEN_SCOPE_OPTIONS.map((option) => (
                <label key={option.id} className={formStyles.choice}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(option.id)}
                    onChange={() => toggleScope(option.id)}
                    aria-label={option.id}
                  />
                  <span className="min-w-0 text-xs">
                    <span className="text-foreground font-mono">{option.id}</span>
                    <span className="text-muted-foreground"> — {option.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {forbidden && (
              <p role="alert" data-testid="access-tokens-forbidden" className={formStyles.error}>
                {forbidden.message} {ACCESS_TOKENS_FORBIDDEN_EXPLANATION}
              </p>
            )}
            {otherError && (
              <p data-testid="access-tokens-error" className={formStyles.error}>
                {otherError.message}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
