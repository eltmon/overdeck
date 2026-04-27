import type { QueryClient } from '@tanstack/react-query';
import type { DashboardSnapshot } from '@panctl/contracts';
import { WS_METHODS } from '@panctl/contracts';
import { useDashboardStore } from './store';
import { getTransport, type PanRpcProtocolClient } from './wsTransport';

export async function refreshDashboardState(queryClient?: QueryClient): Promise<void> {
  await Promise.allSettled([
    queryClient?.invalidateQueries({ queryKey: ['issues'] }),
    queryClient?.invalidateQueries({ queryKey: ['agents'] }),
    queryClient?.invalidateQueries({ queryKey: ['review-status'] }),
    queryClient?.invalidateQueries({ queryKey: ['agent-session'] }),
  ]);

  try {
    const snapshot = await getTransport().request((client) =>
      (client as PanRpcProtocolClient)[WS_METHODS.getSnapshot]({}),
    ) as DashboardSnapshot;
    useDashboardStore.getState().syncSnapshot(snapshot);
  } catch (err) {
    console.warn('[dashboard] Failed to refresh live snapshot after mutation:', err);
  }
}
