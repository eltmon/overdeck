/**
 * LeftColumnFooter — the left column's footer (PAN-5293 F-D19): Settings,
 * Machines, the version button (opens the updater; its tooltip says whether
 * this is a source checkout, replacing the DEV/PROD badge), Rebuild in a
 * source checkout only, the freshness indicator, and `?` for the shortcuts
 * sheet. The theme toggle and search live in the top bar.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowUpCircle, Hammer, Loader2, Settings } from 'lucide-react';
import type { Tab } from '../Header';
import { FreshnessIndicator } from '../FreshnessIndicator';
import { MachinesNavItem } from '../sidebar/MachinesNavItem';

export interface LeftColumnFooterProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenUpdater: () => void;
  onOpenShortcuts: () => void;
  /** The collapsed column stacks icons vertically. */
  collapsed: boolean;
}

async function fetchVersion(): Promise<{ version: string; isDev?: boolean } | null> {
  const res = await fetch('/api/version');
  if (!res.ok) return null;
  return res.json() as Promise<{ version: string; isDev?: boolean }>;
}

const ICON_BUTTON = 'list-row flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground';

export function LeftColumnFooter({ activeTab, onTabChange, onOpenUpdater, onOpenShortcuts, collapsed }: LeftColumnFooterProps) {
  const { data: versionData } = useQuery({ queryKey: ['version'], queryFn: fetchVersion, staleTime: Infinity });
  const isDev = versionData?.isDev ?? false;
  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/dev/rebuild', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Build failed');
      return data;
    },
  });
  const rebuildTitle = rebuildMutation.isPending
    ? 'Building...'
    : rebuildMutation.isSuccess
      ? 'Build complete · click to rebuild'
      : rebuildMutation.isError
        ? `Build failed: ${(rebuildMutation.error as Error)?.message ?? 'unknown error'} · click to retry`
        : 'Rebuild Overdeck (npm run build)';

  return (
    <div
      data-testid="left-column-footer"
      className={`shrink-0 border-t border-border px-2 py-2 ${collapsed ? 'flex flex-col items-center gap-1' : 'flex flex-nowrap items-center gap-0.5'}`}
    >
      <button
        type="button"
        data-testid="sidebar-settings-pinned"
        onClick={() => onTabChange('settings')}
        title="Settings"
        aria-label="Settings"
        aria-current={activeTab === 'settings' ? 'page' : undefined}
        className={`${ICON_BUTTON} ${activeTab === 'settings' ? 'bg-accent text-foreground' : ''}`}
      >
        <Settings aria-hidden className="h-4 w-4" />
      </button>
      <MachinesNavItem variant="footer" collapsed={collapsed} onOpenSettings={() => onTabChange('settings')} />
      {versionData?.version && (
        <button
          type="button"
          data-testid="left-column-version"
          onClick={onOpenUpdater}
          title={isDev ? 'Running from a source checkout · click to check for updates' : 'Click to check for updates'}
          aria-label={`Overdeck version ${versionData.version}. Click to check for updates.`}
          className={collapsed ? ICON_BUTTON : 'list-row shrink-0 rounded-md px-1 py-1 font-mono text-[11px] text-muted-foreground'}
        >
          {collapsed ? <ArrowUpCircle aria-hidden className="h-4 w-4" /> : `v${versionData.version}`}
        </button>
      )}
      {isDev && (
        <button
          type="button"
          data-testid="sidebar-rebuild"
          onClick={() => rebuildMutation.mutate()}
          disabled={rebuildMutation.isPending}
          title={rebuildTitle}
          aria-label="Rebuild Overdeck"
          className={`${ICON_BUTTON} disabled:opacity-50`}
        >
          {rebuildMutation.isPending
            ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            : <Hammer aria-hidden className={`h-4 w-4 ${rebuildMutation.isError ? 'text-destructive-foreground' : ''}`} />}
        </button>
      )}
      <span className={collapsed ? '' : 'ml-auto shrink-0'}>
        <FreshnessIndicator />
      </span>
      <button
        type="button"
        data-testid="left-column-shortcuts"
        onClick={onOpenShortcuts}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        className={`${ICON_BUTTON} font-mono text-xs`}
      >
        ?
      </button>
    </div>
  );
}
