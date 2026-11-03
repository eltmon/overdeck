import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { useConfirm } from '../../DialogProvider';
import {
  ANYWHERE_DEVICES_QUERY_KEY,
  ANYWHERE_STATUS_QUERY_KEY,
  apiError,
  isOk,
  loadDevices,
  revokeDevice,
  type DeviceRow,
} from './anywhereApi';

/** Phones paired with this machine through the Overdeck app (PAN-4836, epic PAN-4823 W-MAC2), with Remove. */
export function PairedPhonesList() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: devices, error, isLoading } = useQuery({
    queryKey: ANYWHERE_DEVICES_QUERY_KEY,
    queryFn: loadDevices,
    refetchInterval: 5000,
  });

  const phones = (devices ?? []).filter((device) => device.kind === 'phone' && device.revokedAt === null);

  const handleRemove = async (device: DeviceRow) => {
    const confirmed = await confirm({
      title: `Remove ${device.name}?`,
      message: 'The phone app is signed out of this machine and its open connections close now.',
      confirmLabel: 'Remove',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await revokeDevice(device.id);
      if (!isOk(result)) toast.error(apiError(result));
    } catch (err) {
      toast.error((err as Error).message);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ANYWHERE_DEVICES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ANYWHERE_STATUS_QUERY_KEY }),
    ]);
  };

  return (
    <div data-component="paired-phones-list">
      <h4 className="text-sm font-medium text-foreground">Phones paired with this machine</h4>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading phones…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load phones: {(error as Error).message}</p>
      ) : phones.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No phones are paired with this machine yet.</p>
      ) : (
        <ul className="space-y-1">
          {phones.map((device) => (
            <li
              key={device.id}
              data-device-id={device.id}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-foreground">{device.name}</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  paired {formatRelativeTime(device.createdAt)}
                  {' · '}last seen {device.lastUsedAt ? formatRelativeTime(device.lastUsedAt) : '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRemove(device)}
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
