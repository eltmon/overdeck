import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { fetchVaultStatus, syncVaultNow, VAULT_STATUS_QUERY_KEY } from '../chat/continueOnDevice/continueOnDeviceApi';
import { MenuItemButton } from '../shared/ContextMenu';

/**
 * "Check for new conversations" on a vault browse row's menu (PAN-4455 FR-14,
 * D-17): one queued Sync now, so a conversation another machine just handed
 * off appears without waiting for the next sync. Shown only where the vault
 * service runs; the status query runs only while the menu is open.
 */
export function VaultRowSyncMenuItem({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: VAULT_STATUS_QUERY_KEY, queryFn: fetchVaultStatus });
  const [pending, setPending] = useState(false);
  if (data?.running !== true) return null;

  const handleClick = async (event: React.MouseEvent) => {
    event.stopPropagation();
    setPending(true);
    try {
      const { status, body } = await syncVaultNow();
      if (status === 200) {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        void queryClient.invalidateQueries({ queryKey: VAULT_STATUS_QUERY_KEY });
        toast.success('Checked for new conversations');
      } else {
        toast.error((body as { error?: string } | null)?.error ?? `Sync failed (${status}).`);
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
      onDone();
    }
  };

  return (
    <MenuItemButton onClick={(e) => void handleClick(e)} disabled={pending}>
      <RefreshCw size={14} />
      {pending ? 'Checking…' : 'Check for new conversations'}
    </MenuItemButton>
  );
}
