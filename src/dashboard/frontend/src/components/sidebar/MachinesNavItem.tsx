/**
 * Sidebar "Machines" row (PAN-4869): a shortcut to Settings → Anywhere with the
 * number of linked machines online. Not a Tab — every Tab maps to a URL — so it
 * never shows the active highlight. Shares MACHINES_QUERY_KEY so link/unlink
 * invalidations refresh the count.
 */
import { useQuery } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import { loadMachines, MACHINES_QUERY_KEY } from '../Settings/anywhere/machinesApi';
import { requestSettingsSection } from '../../lib/settingsSection';

export function useOnlineMachineCount(): number {
  const { data } = useQuery({ queryKey: MACHINES_QUERY_KEY, queryFn: loadMachines, staleTime: 15_000, refetchInterval: 30_000 });
  return Array.isArray(data?.links) ? data.links.filter((l) => l.state === 'online').length : 0;
}

export function MachinesNavItem({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings: () => void }) {
  const online = useOnlineMachineCount();
  return (
    <button
      type="button"
      data-testid="sidebar-machines"
      onClick={() => { requestSettingsSection('anywhere'); onOpenSettings(); }}
      title={collapsed ? (online > 0 ? `Machines · ${online} online` : 'Machines') : undefined}
      className={`
        w-full flex items-center gap-3 transition-colors duration-150 text-sm font-medium
        ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-1.5'}
        text-muted-foreground hover:bg-accent hover:text-foreground border-l-2 border-transparent
      `}
    >
      <Network className="shrink-0 w-4 h-4" />
      {!collapsed && <span className="truncate">Machines</span>}
      {!collapsed && online > 0 && (
        <span
          data-testid="sidebar-machines-online"
          title={`${online} linked machine${online === 1 ? '' : 's'} online`}
          className="ml-auto inline-flex items-center rounded-md border px-1.5 text-[10px] font-medium bg-info/8 border-info/32 text-info-foreground"
        >
          {online}
        </span>
      )}
    </button>
  );
}
