/**
 * PAN-4927 W-OAUTH2 (PAN-4946): the Sign-ins list in Settings → Access Tokens.
 * Lists every active MCP OAuth sign-in with its access level and times, and
 * ends one with Revoke (`DELETE /api/mcp-oauth/sign-ins/:familyId`).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { AccessTokensForbiddenError } from '../sections/accessTokensShared';
import {
  ANYWHERE_ACCESS_TOKENS_QUERY_KEY,
  apiError,
  expiresInText,
  isOk,
  loadMcpSignIns,
  MCP_OAUTH_LEVEL_LABELS,
  MCP_SIGN_INS_QUERY_KEY,
  revokeMcpSignIn,
  type McpSignIn,
} from './anywhereApi';

/**
 * McpSignInsList — active MCP OAuth sign-ins, with Revoke (PAN-4946, PRD WI-5).
 * Shares its record shape and query key with nothing else: `access-tokens`
 * covers the dashboard's own token kind, this covers the OAuth client kind,
 * and Revoke here also invalidates `ANYWHERE_ACCESS_TOKENS_QUERY_KEY` since a
 * family's access token is itself a `kind: 'token'` record.
 */
export function McpSignInsList() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: signIns, error, isLoading } = useQuery({
    queryKey: MCP_SIGN_INS_QUERY_KEY,
    queryFn: loadMcpSignIns,
    refetchInterval: 5000,
    retry: false,
  });

  const handleRevoke = async (signIn: McpSignIn) => {
    const confirmed = await confirm({
      title: `Revoke ${signIn.clientName}?`,
      message: 'The sign-in ends now. Its access and refresh tokens stop working, and the app must sign in again.',
      confirmLabel: 'Revoke',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await revokeMcpSignIn(signIn.familyId);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: MCP_SIGN_INS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: ANYWHERE_ACCESS_TOKENS_QUERY_KEY });
  };

  return (
    <div data-component="mcp-sign-ins-list">
      <h3 className="text-sm font-medium text-foreground mb-2">Sign-ins</h3>
      <p className="text-xs text-muted-foreground mb-2">MCP clients signed in to this dashboard over OAuth.</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading sign-ins…</p>
      ) : error instanceof AccessTokensForbiddenError ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Only a browser on this machine can list sign-ins.</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load sign-ins: {(error as Error).message}</p>
      ) : !signIns || signIns.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No sign-ins. An MCP client that signs in with OAuth appears here after you approve it.</p>
      ) : (
        <ul className="space-y-1">
          {signIns.map((signIn) => (
            <li
              key={signIn.familyId}
              data-family-id={signIn.familyId}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{signIn.clientName}</span>
                {signIn.headless && (
                  <span className="ml-2 inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    headless
                  </span>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {MCP_OAUTH_LEVEL_LABELS[signIn.level as keyof typeof MCP_OAUTH_LEVEL_LABELS] ?? signIn.level}
                  {' · '}created {formatRelativeTime(signIn.createdAt)}
                  {' · '}last used {signIn.lastUsedAt ? formatRelativeTime(signIn.lastUsedAt) : '—'}
                  {' · '}expires {expiresInText(signIn.refreshExpiresAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRevoke(signIn)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
