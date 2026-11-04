import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { AccessTokensForbiddenError, partitionAgentTokens, type AccessTokenRecord } from '../sections/accessTokensShared';
import {
  ANYWHERE_ACCESS_TOKENS_QUERY_KEY,
  apiError,
  isOk,
  loadAccessTokens,
  revokeAccessToken,
} from './anywhereApi';

/**
 * Access tokens beside Copy MCP URL (PAN-4649 FR-10): list `kind: 'token'`
 * records and revoke one after an in-app confirmation. Shares its query key
 * and record type with `sections/AccessTokensSection`, so both refresh together.
 */
export function AccessTokensPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [showAgentTokens, setShowAgentTokens] = useState(false);
  const { data: tokens, error, isLoading } = useQuery({
    queryKey: ANYWHERE_ACCESS_TOKENS_QUERY_KEY,
    queryFn: loadAccessTokens,
    refetchInterval: 5000,
    retry: false,
  });
  const { own, agent } = partitionAgentTokens(tokens ?? []);

  const handleRevoke = async (token: AccessTokenRecord) => {
    const confirmed = await confirm({
      title: `Revoke ${token.name}?`,
      message: 'The token stops working on its next request.',
      confirmLabel: 'Revoke',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await revokeAccessToken(token.id);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: ANYWHERE_ACCESS_TOKENS_QUERY_KEY });
  };

  const renderToken = (token: AccessTokenRecord) => (
    <li
      key={token.id}
      data-token-id={token.id}
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
    >
      <div className="min-w-0">
        <span className={token.revokedAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-foreground'}>
          {token.name}
        </span>
        <p className="text-xs text-muted-foreground mt-0.5">
          {token.scopes.length > 0 ? token.scopes.join(', ') : 'No scopes'}
          {' · '}created {formatRelativeTime(token.createdAt)}
          {' · '}last used {token.lastUsedAt ? formatRelativeTime(token.lastUsedAt) : '—'}
        </p>
      </div>
      {token.revokedAt ? (
        <span className="text-xs text-muted-foreground shrink-0">Revoked {formatRelativeTime(token.revokedAt)}</span>
      ) : (
        <button
          type="button"
          onClick={() => void handleRevoke(token)}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
        >
          Revoke
        </button>
      )}
    </li>
  );

  return (
    <div data-component="anywhere-access-tokens-panel">
      <h3 className="text-sm font-medium text-foreground mb-2">Access tokens</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading access tokens…</p>
      ) : error instanceof AccessTokensForbiddenError ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Only a browser on this machine can list access tokens.</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load access tokens: {(error as Error).message}</p>
      ) : own.length === 0 && agent.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No access tokens. Copy MCP URL creates one.</p>
      ) : (
        <>
          <ul className="space-y-1">{own.map(renderToken)}</ul>
          {agent.length > 0 && (
            <div className="px-4 py-2">
              <button
                type="button"
                data-testid="show-agent-tokens"
                aria-expanded={showAgentTokens}
                onClick={() => setShowAgentTokens((open) => !open)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAgentTokens ? 'Hide' : 'Show'} agent tokens ({agent.length})
              </button>
              {showAgentTokens && <ul className="space-y-1 mt-1">{agent.map(renderToken)}</ul>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
