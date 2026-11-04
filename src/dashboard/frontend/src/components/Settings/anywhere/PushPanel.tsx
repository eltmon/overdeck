import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import {
  deletePushSubscription,
  loadPushStatus,
  PUSH_STATUS_QUERY_KEY,
  sendTestPush,
  type PushStatus,
} from '../../push/pushApi';
import { TurnOnNotificationsButton } from '../../push/TurnOnNotificationsButton';

type SubscriptionRow = PushStatus['webpush']['subscriptions'][number];

function ntfyLine(ntfy: PushStatus['ntfy']): string {
  if (ntfy.state === 'ready') return `ntfy: ${ntfy.host ?? ''} · topic ${ntfy.topicHint ?? ''}`;
  if (ntfy.state === 'misconfigured') return `ntfy: ${ntfy.reason ?? 'misconfigured'}`;
  return 'ntfy: not configured (optional — see docs).';
}

function nativeLine(native: PushStatus['native']): string {
  if (native.phones === 0) return 'Overdeck app: no phones paired.';
  const phones = `Overdeck app: ${native.phones} ${native.phones === 1 ? 'phone' : 'phones'}`;
  return native.directoryOnline ? phones : `${phones} · not connected to overdeck.ai, so no notifications reach them`;
}

/** Settings → Anywhere → Phone notifications: needs-you push devices, test send and ntfy status (PAN-2354). */
export function PushPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: status, error, isLoading } = useQuery({
    queryKey: PUSH_STATUS_QUERY_KEY,
    queryFn: loadPushStatus,
    refetchInterval: 10_000,
  });

  const handleRemove = async (row: SubscriptionRow) => {
    const confirmed = await confirm({
      title: `Remove ${row.label}?`,
      message: 'This device stops receiving needs-you notifications.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await deletePushSubscription(row.id);
      if (row.thisDevice) {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
  };

  const handleTest = async () => {
    try {
      const outcomes = await sendTestPush();
      const sent = outcomes.filter((outcome) => outcome.ok).length;
      const failure = outcomes.find((outcome) => !outcome.ok && outcome.reason !== 'skipped');
      if (failure && !failure.ok) toast.error(`Test failed: ${failure.reason}${failure.status ? ` (${failure.status})` : ''}`);
      else toast.success(`Test sent to ${sent} target(s)`);
    } catch (err) {
      toast.error((err as Error).message);
    }
    await queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
  };

  const subscriptions = status?.webpush.subscriptions ?? [];

  return (
    <div data-component="anywhere-push-panel">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h3 className="text-sm font-medium text-foreground">Phone notifications</h3>
        <div className="flex items-center gap-2">
          <TurnOnNotificationsButton />
          <button
            type="button"
            onClick={() => void handleTest()}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
          >
            Send test
          </button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading notification devices…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load notifications: {(error as Error).message}</p>
      ) : subscriptions.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No browser receives notifications yet.</p>
      ) : (
        <ul className="space-y-1">
          {subscriptions.map((row) => (
            <li
              key={row.id}
              data-subscription-id={row.id}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{row.label}</span>
                {row.thisDevice ? <span className="text-xs text-muted-foreground"> · this device</span> : null}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {row.host}
                  {' · '}added {formatRelativeTime(row.createdAt)}
                  {row.failureCount > 0 ? ` · ${row.failureCount} failed` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(row)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {status ? (
        <>
          <p className="text-xs text-muted-foreground px-4 pt-2">{ntfyLine(status.ntfy)}</p>
          <p data-testid="push-native-line" className="text-xs text-muted-foreground px-4 pt-1">{nativeLine(status.native)}</p>
        </>
      ) : null}
    </div>
  );
}
