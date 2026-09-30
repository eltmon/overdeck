import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useConfirm } from '../../DialogProvider';
import { dashboardMutationJsonHeaders, ensureDashboardSession } from '../../../lib/wsTransport';
import { type SettingsConfig } from '../types';

export interface AccessTokenRecord {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt?: string;
}

interface AccessTokensSectionProps {
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

/** A 403 from any access-token route (PAN-4435 D-8). */
export class AccessTokensForbiddenError extends Error {}

const FORBIDDEN_EXPLANATION =
  'This browser is signed in as a paired device or with a scoped token. Only this machine\'s own dashboard session can create or revoke access tokens; use `pan token` on this machine instead.';

async function throwForResponse(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  const message = body?.error ?? fallback;
  if (res.status === 403) throw new AccessTokensForbiddenError(message);
  throw new Error(message);
}

async function fetchAccessTokens(): Promise<AccessTokenRecord[]> {
  const res = await fetch('/api/access-tokens', { credentials: 'include' });
  if (!res.ok) return throwForResponse(res, `Failed to load access tokens (${res.status})`);
  const body = await res.json() as { tokens: AccessTokenRecord[] };
  return body.tokens;
}

async function revokeAccessToken(id: string): Promise<void> {
  await ensureDashboardSession();
  const res = await fetch(`/api/access-tokens/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
  });
  if (!res.ok) return throwForResponse(res, `Failed to revoke access token (${res.status})`);
}

function formatTimestamp(iso: string | null): string {
  if (iso === null) return 'Never';
  return new Date(iso).toLocaleString();
}

export function AccessTokensSection({ formData: _formData, onSettingsChange: _onSettingsChange }: AccessTokensSectionProps) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [error, setError] = useState<Error | null>(null);

  const { data: tokens, error: queryError } = useQuery({
    queryKey: ['access-tokens'],
    queryFn: fetchAccessTokens,
    retry: false,
  });

  const revoke = useMutation({
    mutationFn: revokeAccessToken,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['access-tokens'] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err : new Error(String(err)));
    },
  });

  const activeError = error ?? queryError;
  const forbidden = activeError instanceof AccessTokensForbiddenError ? activeError : null;
  const otherError = activeError && !forbidden ? activeError : null;

  const handleRevoke = async (record: AccessTokenRecord) => {
    const ok = await confirm({
      title: 'Revoke access token?',
      message: `Requests using "${record.name}" stop working at once and its open connections close.`,
      confirmLabel: 'Revoke',
      variant: 'destructive',
    });
    if (ok) {
      setError(null);
      revoke.mutate(record.id);
    }
  };

  return (
    <section id="access-tokens" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-muted-foreground" />
        Access Tokens
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Scoped API tokens let a script, sidecar or another machine call this dashboard with{' '}
        <code>Authorization: Bearer odk_…</code>.
      </p>

      {forbidden && (
        <p role="alert" data-testid="access-tokens-forbidden" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive mb-4">
          {forbidden.message} {FORBIDDEN_EXPLANATION}
        </p>
      )}
      {otherError && (
        <p data-testid="access-tokens-error" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive mb-4">
          {otherError.message}
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Scopes</th>
            <th className="py-2 pr-4 font-medium">Created</th>
            <th className="py-2 pr-4 font-medium">Last used</th>
            <th className="py-2 pr-4 font-medium">Revoked</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tokens?.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-muted-foreground">No access tokens yet.</td>
            </tr>
          )}
          {tokens?.map((record) => (
            <tr key={record.id} className="border-b border-border/50">
              <td className="py-2 pr-4 text-foreground">{record.name}</td>
              <td className="py-2 pr-4 text-muted-foreground">{record.scopes.join(', ')}</td>
              <td className="py-2 pr-4 text-muted-foreground">{new Date(record.createdAt).toLocaleString()}</td>
              <td className="py-2 pr-4 text-muted-foreground">{formatTimestamp(record.lastUsedAt)}</td>
              <td className="py-2 pr-4 text-muted-foreground">{record.revokedAt ? new Date(record.revokedAt).toLocaleString() : '—'}</td>
              <td className="py-2">
                {!record.revokedAt && (
                  <button
                    type="button"
                    data-testid={`access-token-revoke-${record.id}`}
                    onClick={() => void handleRevoke(record)}
                    disabled={revoke.isPending}
                    className="text-xs px-2 py-1 rounded-md border border-border bg-background hover:bg-muted/50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
