/**
 * PAN-4927 W-BOT1 (PAN-4951): the Bots panel beside Access tokens — the active
 * connectors (name, scopes, created, last used) with Remove, and "Connect a
 * bot". FR-1: a non-root viewer sees only the forbidden text, no button.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import { apiError, isOk } from './anywhereApi';
import { openAnywhereDialog } from './anywhereDialogStore';
import {
  BOTS_CONNECTORS_QUERY_KEY,
  BotsForbiddenError,
  type ConnectorRow,
  loadConnectors,
  removeConnector,
} from './botsApi';

export function BotsPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: connectors, error, isLoading } = useQuery({
    queryKey: BOTS_CONNECTORS_QUERY_KEY,
    queryFn: loadConnectors,
    refetchInterval: 5000,
    retry: false,
  });

  const forbidden = error instanceof BotsForbiddenError;

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
    await queryClient.invalidateQueries({ queryKey: BOTS_CONNECTORS_QUERY_KEY });
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
      ) : !connectors || connectors.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No bots connected.</p>
      ) : (
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
    </div>
  );
}
