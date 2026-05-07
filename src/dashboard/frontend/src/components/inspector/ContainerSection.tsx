import { useRef, useEffect, useState } from 'react';
import { Box, Database, Loader2, RefreshCw, Square, Play, Check, X, Activity } from 'lucide-react';
import type { ContainerStatus, ContainerMenuState } from './types';
import { COMMAND_DECK_SURFACE_REGISTRY } from '../../lib/commandDeckSurfaceRegistry';

void COMMAND_DECK_SURFACE_REGISTRY;

interface ContainerSectionProps {
  containers: Record<string, ContainerStatus>;
  startPending: boolean;
  containersStarting: boolean;
  containerControlPending: boolean;
  controllingContainer?: string;
  containerMenu: ContainerMenuState | null;
  onContainerContextMenu: (e: React.MouseEvent, name: string, isRunning: boolean) => void;
  onSetContainerMenu: (menu: ContainerMenuState | null) => void;
  onContainerControl: (containerName: string, action: 'start' | 'stop' | 'restart') => void;
  onRefreshDb: () => void;
  refreshDbPending: boolean;
  confirm: (opts: { title: string; message: string; variant?: 'default' | 'destructive'; confirmLabel?: string }) => Promise<boolean>;
}

export function ContainerSection({
  containers,
  startPending,
  containersStarting,
  containerControlPending,
  controllingContainer,
  containerMenu,
  onContainerContextMenu,
  onSetContainerMenu,
  onContainerControl,
  onRefreshDb,
  refreshDbPending,
  confirm,
}: ContainerSectionProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

  useEffect(() => {
    if (!containerMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onSetContainerMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [containerMenu, onSetContainerMenu]);

  return (
    <>
      <div className="px-3 py-2 border-b border-border text-xs">
        <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-muted-foreground">
          Containers
          <span className="font-normal ml-2 text-muted-foreground/60">(right-click)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(containers).map(([name, status]) => {
            const isStarting = (startPending || containersStarting) && !status.running && !status.status?.startsWith('exited');
            const isControlling = containerControlPending && controllingContainer === name;
            const isFailed = status.status?.startsWith('exited') && !status.running;
            const serviceHealth = status.running ? status.health : undefined;
            const chipStyle =
              isFailed ? 'badge-bg-destructive text-destructive' :
              isStarting || isControlling ? 'badge-bg-warning text-warning animate-pulse' :
              !status.running ? 'bg-card text-muted-foreground' :
              serviceHealth === 'healthy' ? 'badge-bg-success text-success' :
              serviceHealth === 'unhealthy' ? 'badge-bg-destructive text-destructive' :
              serviceHealth === 'starting' ? 'badge-bg-warning text-warning animate-pulse' :
              'badge-bg-success text-success';
            const icon =
              isStarting || isControlling || serviceHealth === 'starting' ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> :
              serviceHealth === 'healthy' ? <Check className="w-2.5 h-2.5" /> :
              serviceHealth === 'unhealthy' ? <X className="w-2.5 h-2.5" /> :
              name === 'postgres' || name === 'redis' ? <Database className="w-2.5 h-2.5" /> :
              <Box className="w-2.5 h-2.5" />;
            const title = [
              name,
              status.running && status.uptime ? `Up ${status.uptime}` : null,
              serviceHealth ? `Health: ${serviceHealth}` : null,
              status.lastFailureReason ? `Last failure: ${status.lastFailureReason}` : null,
              status.ports?.length ? `Ports: ${status.ports.join(', ')}` : null,
            ].filter(Boolean).join(' • ');
            return (
              <div key={name} className="flex flex-col gap-1">
                <span
                  onContextMenu={(e) => onContainerContextMenu(e, name, status.running)}
                  onClick={() => setExpandedContainer(expandedContainer === name ? null : name)}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer select-none ${chipStyle}`}
                  title={title || 'Right-click for options'}
                >
                  {icon}
                  {name}
                  {status.running && status.uptime && (serviceHealth === 'unknown' || !serviceHealth) && <span className="ml-1 text-muted-foreground">{status.uptime}</span>}
                  {isFailed && <span className="text-destructive ml-1">{status.status}</span>}
                </span>
                {expandedContainer === name && (
                  <div className="px-2 py-1.5 rounded bg-card border border-border text-[10px] text-muted-foreground space-y-0.5 min-w-[180px]">
                    {status.ports && status.ports.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Activity className="w-2.5 h-2.5" />
                        <span>Ports: {status.ports.join(', ')}</span>
                      </div>
                    )}
                    {status.lastProbeAt && (
                      <div>Last probe: {new Date(status.lastProbeAt).toLocaleString()}</div>
                    )}
                    {status.lastFailureReason && (
                      <div className="text-destructive">Last failure: {status.lastFailureReason}</div>
                    )}
                    {!status.ports?.length && !status.lastProbeAt && !status.lastFailureReason && (
                      <div>No probe data available</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Container context menu */}
      {containerMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 border border-border rounded shadow-lg py-1 min-w-[140px] bg-card"
          style={{ left: containerMenu.x, top: containerMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-xs border-b border-border mb-1 text-muted-foreground">
            {containerMenu.containerName}
          </div>
          {containerMenu.isRunning ? (
            <>
              <button
                onClick={() => onContainerControl(containerMenu.containerName, 'restart')}
                disabled={containerControlPending}
                className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-popover flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className="w-3 h-3" />Restart
              </button>
              <button
                onClick={() => onContainerControl(containerMenu.containerName, 'stop')}
                disabled={containerControlPending}
                className="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-popover flex items-center gap-2 disabled:opacity-50"
              >
                <Square className="w-3 h-3" />Stop
              </button>
              {containerMenu.containerName === 'postgres' && (
                <>
                  <div className="border-t border-border my-1" />
                  <button
                    onClick={async () => {
                      if (await confirm({ title: 'Refresh Database', message: 'Drop and reload database from seed file?\n\nThis will:\n- Stop the API container\n- Drop the existing database\n- Reload from seed-cleaned.sql\n- Restart the API\n\nAll workspace data will be replaced.', variant: 'destructive', confirmLabel: 'Refresh DB' })) {
                        onRefreshDb();
                        onSetContainerMenu(null);
                      }
                    }}
                    disabled={refreshDbPending}
                    className="w-full text-left px-3 py-1.5 text-xs text-amber-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Database className="w-3 h-3" />{refreshDbPending ? 'Refreshing...' : 'Refresh DB'}
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              onClick={() => onContainerControl(containerMenu.containerName, 'start')}
              disabled={containerControlPending}
              className="w-full text-left px-3 py-1.5 text-xs text-success hover:bg-popover flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />Start
            </button>
          )}
        </div>
      )}
    </>
  );
}
