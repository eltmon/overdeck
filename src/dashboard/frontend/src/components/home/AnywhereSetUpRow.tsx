/**
 * "Reach this machine from anywhere" row on the Home page's Get set up card
 * (PAN-4869 FR-7). Shows only while no machine is linked and Tailscale is not
 * ready (D13); clicking Set up shows Settings → Anywhere. This row never
 * feeds `hasRequiredFailing`, so it never keeps a dismissed card visible.
 */
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ANYWHERE_STATUS_QUERY_KEY, loadAnywhereStatus } from '../Settings/anywhere/anywhereApi';
import { loadMachines, MACHINES_QUERY_KEY } from '../Settings/anywhere/machinesApi';
import { requestSettingsSection } from '../../lib/settingsSection';

export function AnywhereSetUpRow({ setUpLabel, onOpenSettings }: { setUpLabel: string; onOpenSettings: () => void }) {
  const machinesQuery = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, staleTime: 60_000 });
  const statusQuery = useQuery({ queryKey: ANYWHERE_STATUS_QUERY_KEY, queryFn: loadAnywhereStatus, staleTime: 60_000 });

  const noMachineLinked = machinesQuery.isSuccess && Array.isArray(machinesQuery.data?.links) && machinesQuery.data.links.length === 0;
  const nextStep = statusQuery.data?.tailscale?.nextStep;
  const tailscaleNotReady = statusQuery.isSuccess && typeof nextStep === 'string' && nextStep !== 'ready';

  if (!noMachineLinked || !tailscaleNotReady) return null;

  return (
    <div className="py-2" data-testid="get-set-up-anywhere">
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle className="w-4 h-4 text-warning-foreground shrink-0" aria-label="to do" />
        <span className="flex-1 text-sm text-foreground min-w-0">Reach this machine from anywhere</span>
        <button
          onClick={() => { requestSettingsSection('anywhere'); onOpenSettings(); }}
          className="px-2.5 py-1 text-xs font-medium rounded-sm bg-card border border-border text-foreground hover:bg-card-2 shrink-0"
        >
          {setUpLabel}
        </button>
      </div>
    </div>
  );
}
