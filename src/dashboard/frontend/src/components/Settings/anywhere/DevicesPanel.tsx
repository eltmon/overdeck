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

/** Paired devices with their scopes; revoke one after an in-app confirmation (PAN-4445 FR-9). */
export function DevicesPanel() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: devices, error, isLoading } = useQuery({
    queryKey: ANYWHERE_DEVICES_QUERY_KEY,
    queryFn: loadDevices,
    refetchInterval: 5000,
  });

  const handleRevoke = async (device: DeviceRow) => {
    const confirmed = await confirm({
      title: `Revoke ${device.name}?`,
      message: 'The device is signed out on its next request and its open connections close now.',
      confirmLabel: 'Revoke',
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
    <div data-component="anywhere-devices-panel">
      <h3 className="text-sm font-medium text-foreground mb-2">Paired devices</h3>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-3">Loading devices…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-3">Could not load devices: {(error as Error).message}</p>
      ) : !devices || devices.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No devices are paired yet.</p>
      ) : (
        <ul className="space-y-1">
          {devices.map((device) => (
            <li
              key={device.id}
              data-device-id={device.id}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <span className={device.revokedAt ? 'text-sm text-muted-foreground' : 'text-sm font-medium text-foreground'}>
                  {device.name}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {device.scopes.length > 0 ? device.scopes.join(', ') : 'No scopes'}
                  {' · '}paired {formatRelativeTime(device.createdAt)}
                  {' · '}last seen {device.lastUsedAt ? formatRelativeTime(device.lastUsedAt) : '—'}
                </p>
              </div>
              {device.revokedAt ? (
                <span className="text-xs text-muted-foreground shrink-0">Revoked {formatRelativeTime(device.revokedAt)}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleRevoke(device)}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
