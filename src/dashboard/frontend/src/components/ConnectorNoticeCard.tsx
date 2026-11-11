/**
 * ConnectorNoticeCard — a bot connector that just paired with this machine, in
 * Needs you (PAN-5070 W-11). Non-blocking and in the "System" group: nothing
 * waits on it. Revoke removes the connector outright; Dismiss just clears the
 * notice, leaving the connector paired.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Decision } from '../lib/useDecisions';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { useNow } from '../hooks/useNow';
import { useConfirm } from './DialogProvider';
import { apiError, isOk } from './Settings/anywhere/anywhereApi';
import {
  BOTS_CONNECTORS_QUERY_KEY,
  BOTS_CONNECTOR_NOTICES_QUERY_KEY,
  connectorAccessLabel,
  dismissConnectorNotice,
  removeConnector,
} from './Settings/anywhere/botsApi';
import styles from './styles/decisions.module.css';

export function ConnectorNoticeCard({ decision }: { decision: Decision }) {
  const notice = decision.connectorNotice;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!notice) return null;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: BOTS_CONNECTOR_NOTICES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: BOTS_CONNECTORS_QUERY_KEY }),
    ]);
  };

  const handleRevoke = async () => {
    const confirmed = await confirm({
      title: `Remove ${notice.name}?`,
      message: 'The connector loses access at once.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await removeConnector(notice.connectorId);
      if (!isOk(result)) setError(apiError(result));
    } catch {
      setError('Could not reach the dashboard');
    } finally {
      await invalidate();
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await dismissConnectorNotice(notice.id);
      if (!isOk(result)) setError(apiError(result));
    } catch {
      setError('Could not reach the dashboard');
    } finally {
      await invalidate();
      setBusy(false);
    }
  };

  return (
    <div className={styles.row} data-testid="connector-notice-card" data-decision-id={decision.id}>
      <div className={styles.rowMain}>
        <div className={styles.rowTop}>
          <span className={styles.badge}>Bot connected</span>
        </div>
        <p className={styles.prompt}>{`${notice.name} connected with ${connectorAccessLabel(notice.scopes)}`}</p>
        <p className={styles.meta}>{`connected ${formatRelativeTime(notice.pairedAt, now)}`}</p>
        <div className={styles.secretForm}>
          <button type="button" className={styles.answer} disabled={busy} onClick={() => void handleRevoke()}>
            Revoke
          </button>
          <button type="button" className={styles.answer} disabled={busy} onClick={() => void handleDismiss()}>
            Dismiss
          </button>
        </div>
        {error && <p role="alert" className={styles.meta}>{error}</p>}
      </div>
    </div>
  );
}
