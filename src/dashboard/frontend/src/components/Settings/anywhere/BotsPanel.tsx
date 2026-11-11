/**
 * PAN-4927 W-BOT1 (PAN-4951): the Bots panel beside Access tokens — the active
 * connectors (name, scopes, created, last used) with Remove, and "Connect a
 * bot". FR-1: a non-root viewer sees only the forbidden text, no button.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { ANYWHERE_ENVIRONMENT_QUERY_KEY, apiError, expiresInText, isOk, loadEnvironment } from './anywhereApi';
import { openAnywhereDialog } from './anywhereDialogStore';
import {
  BOTS_CONNECTORS_QUERY_KEY,
  BotsForbiddenError,
  type ConnectorRequestRow,
  type ConnectorRow,
  botScopes,
  cancelConnectorRequest,
  connectorAccessLabel,
  createConnectorPairing,
  loadConnectors,
  removeConnector,
} from './botsApi';
import { CONNECT_PLATFORM_LABELS, connectMessageFor, writeClipboard } from './connectMessage';
import { CopyField } from './McpUrlDialog';

/** `expires in N minute(s)` for `live`, `expired` for `expired`, `code used` for `used`. */
function requestExpiryText(request: ConnectorRequestRow): string {
  if (request.state === 'used') return 'code used';
  if (request.state === 'expired') return 'expired';
  return `expires ${expiresInText(request.expiresAt)}`;
}

interface ConnectorRequestItemProps {
  request: ConnectorRequestRow;
  environment: { label?: string; serverVersion?: string } | undefined;
  onChanged: () => void;
}

function ConnectorRequestItem({ request, environment, onChanged }: ConnectorRequestItemProps) {
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const copy = async (message: string) => {
    const copied = await writeClipboard(message);
    if (copied) {
      setFailedMessage(null);
      toast.success(`Copied — paste it into ${CONNECT_PLATFORM_LABELS[request.platform]}.`);
    } else {
      setFailedMessage(message);
    }
  };

  const handleCopyAgain = async () => {
    if (!request.pairingString) return;
    await copy(connectMessageFor({ platform: request.platform, botName: request.name, pairingString: request.pairingString, environment }));
    onChanged();
  };

  const handleCopyNew = async () => {
    try {
      const result = await createConnectorPairing(request.name, botScopes(request.scopes), request.platform);
      if (!isOk(result)) {
        toast.error(apiError(result));
        return;
      }
      await cancelConnectorRequest(request.id);
      await copy(connectMessageFor({ platform: request.platform, botName: request.name, pairingString: result.body.pairingString, environment }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      onChanged();
    }
  };

  const handleCancel = async () => {
    try {
      const result = await cancelConnectorRequest(request.id);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      onChanged();
    }
  };

  return (
    <li data-request-id={request.id} className="px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors space-y-1">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground">{request.name}</span>
          <p className="text-xs text-muted-foreground mt-0.5">
            {CONNECT_PLATFORM_LABELS[request.platform]}
            {' · '}{connectorAccessLabel(request.scopes)}
            {' · '}{requestExpiryText(request)}
          </p>
        </div>
        <div className="shrink-0 flex gap-2">
          {request.state === 'live' ? (
            <button
              type="button"
              onClick={() => void handleCopyAgain()}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
            >
              Copy again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleCopyNew()}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
            >
              Copy new
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {failedMessage !== null && <CopyField label="Message" value={failedMessage} multiline />}
    </li>
  );
}

export function BotsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, error, isLoading } = useQuery({
    queryKey: BOTS_CONNECTORS_QUERY_KEY,
    queryFn: loadConnectors,
    refetchInterval: 5000,
    retry: false,
  });
  const { data: environment } = useQuery({ queryKey: ANYWHERE_ENVIRONMENT_QUERY_KEY, queryFn: loadEnvironment });

  const forbidden = error instanceof BotsForbiddenError;
  const connectors = data?.connectors ?? [];
  const requests = data?.requests ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: BOTS_CONNECTORS_QUERY_KEY });
  };

  const handleRemove = async (connector: ConnectorRow) => {
    const confirmed = await confirm({
      title: `Remove ${connector.name}?`,
      message: 'The connector loses access at once.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await removeConnector(connector.id);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    }
    invalidate();
  };

  return (
    <div data-component="anywhere-bots-panel">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">Bots</h3>
        {!forbidden && (
          <button
            type="button"
            onClick={() => openAnywhereDialog('connect-bot')}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
          >
            Connect a bot
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading bots…</p>
      ) : forbidden ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Only a browser on this machine can manage bots.</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load bots: {(error as Error).message}</p>
      ) : connectors.length === 0 && requests.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No bots connected.</p>
      ) : (
        <>
          {connectors.length > 0 && (
            <ul className="space-y-1">
              {connectors.map((connector) => (
                <li
                  key={connector.id}
                  data-connector-id={connector.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{connector.name}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {connector.scopes.length > 0 ? connector.scopes.join(', ') : 'No scopes'}
                      {' · '}created {formatRelativeTime(connector.createdAt)}
                      {' · '}last used {connector.lastUsedAt ? formatRelativeTime(connector.lastUsedAt) : '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemove(connector)}
                    className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {requests.length > 0 && (
            <div className="mt-2">
              <h4 className="text-xs font-medium text-muted-foreground px-4 pb-1">Waiting to connect</h4>
              <ul className="space-y-1">
                {requests.map((request) => (
                  <ConnectorRequestItem key={request.id} request={request} environment={environment} onChanged={invalidate} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
