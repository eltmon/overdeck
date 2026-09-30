import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={handleClose}
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose(); }}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Create access token</h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          {created ? (
            <div className="space-y-3">
              <p className="text-foreground">Copy this token now. It is not shown again.</p>
              <input
                type="text"
                readOnly
                data-testid="access-token-plaintext"
                value={created.token}
                className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground font-mono"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <>
              <label className="block">
                <span className="text-xs text-muted-foreground">Name</span>
                <input
                  type="text"
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <div className="space-y-2">
                <span className="text-xs text-muted-foreground">Scopes</span>
                {ACCESS_TOKEN_SCOPE_OPTIONS.map((option) => (
                  <label key={option.id} className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={scopes.includes(option.id)}
                      onChange={() => toggleScope(option.id)}
                      aria-label={option.id}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="text-foreground font-mono">{option.id}</span>
                      <span className="text-muted-foreground"> — {option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {forbidden && (
                <p role="alert" data-testid="access-tokens-forbidden" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {forbidden.message} {ACCESS_TOKENS_FORBIDDEN_EXPLANATION}
                </p>
              )}
              {otherError && (
                <p data-testid="access-tokens-error" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {otherError.message}
                </p>
              )}
            </>
          )}
        </div>

        {!created && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/30 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => mutation.mutate()}
              disabled={!canCreate || mutation.isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              Create
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
