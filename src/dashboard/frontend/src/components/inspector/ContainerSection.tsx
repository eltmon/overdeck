import { useRef, useEffect } from 'react';
import { Box, Database, Loader2, RefreshCw, Square, Play } from 'lucide-react';

interface ContainerStatus {
  running: boolean;
  uptime: string | null;
  status?: string;
}

interface ContainerMenuState {
  x: number;
  y: number;
  containerName: string;
  isRunning: boolean;
}

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
      <div className="px-3 py-2 border-b border-pan-border text-xs">
        <div className="uppercase tracking-wider text-[10px] mb-2 font-semibold text-pan-text-secondary">
          Containers
          <span className="font-normal ml-2 text-pan-text-secondary/60">(right-click)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(containers).map(([name, status]) => {
            const isStarting = (startPending || containersStarting) && !status.running && !status.status?.startsWith('exited');
            const isControlling = containerControlPending && controllingContainer === name;
            const isFailed = status.status?.startsWith('exited') && !status.running;
            return (
              <span
                key={name}
                onContextMenu={(e) => onContainerContextMenu(e, name, status.running)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-context-menu select-none ${
                  status.running ? 'bg-green-900/30 text-green-400' :
                  isFailed ? 'bg-red-900/30 text-red-400' :
                  isStarting || isControlling ? 'bg-yellow-900/30 text-yellow-400 animate-pulse' :
                  'bg-pan-border text-gray-400'
                }`}
                title="Right-click for options"
              >
                {isStarting || isControlling ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> :
                  name === 'postgres' || name === 'redis' ? <Database className="w-2.5 h-2.5" /> : <Box className="w-2.5 h-2.5" />}
                {name}
                {status.running && status.uptime && <span className="ml-1 text-pan-text-secondary">{status.uptime}</span>}
                {isFailed && <span className="text-red-500 ml-1">{status.status}</span>}
              </span>
            );
          })}
        </div>
      </div>

      {/* Container context menu */}
      {containerMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 border border-pan-border rounded shadow-lg py-1 min-w-[140px] bg-pan-panel-left"
          style={{ left: containerMenu.x, top: containerMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-xs border-b border-pan-border mb-1 text-pan-text-secondary">
            {containerMenu.containerName}
          </div>
          {containerMenu.isRunning ? (
            <>
              <button
                onClick={() => onContainerControl(containerMenu.containerName, 'restart')}
                disabled={containerControlPending}
                className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
              >
                <RefreshCw className="w-3 h-3" />Restart
              </button>
              <button
                onClick={() => onContainerControl(containerMenu.containerName, 'stop')}
                disabled={containerControlPending}
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
              >
                <Square className="w-3 h-3" />Stop
              </button>
              {containerMenu.containerName === 'postgres' && (
                <>
                  <div className="border-t border-pan-border my-1" />
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
              className="w-full text-left px-3 py-1.5 text-xs text-green-400 hover:bg-white/5 flex items-center gap-2 disabled:opacity-50"
            >
              <Play className="w-3 h-3" />Start
            </button>
          )}
        </div>
      )}
    </>
  );
}
