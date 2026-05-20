import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Eye, LayoutGrid, Bot, Server,
  Terminal, BarChart3, DollarSign, HeartPulse, Cpu, Settings,
  Zap, Compass, GitBranch, GitMerge, ChevronsLeft, ChevronsRight, Sun, Moon, Menu,
  Hammer, Loader2, History, Mic,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CloisterStatusBar } from './CloisterStatusBar';
import { FreshnessIndicator } from './FreshnessIndicator';
import { DeaconPauseToggle } from './DeaconPauseToggle';
import { useTheme } from '../hooks/useTheme';
import type { Tab } from './Header';

const SIDEBAR_STORAGE_KEY = 'panopticon.ui.sidebarCollapsed';

interface FlywheelRunSummary {
  id: string;
  status: 'running' | 'complete' | 'aborted';
}

interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
  badge?: 'flywheel-live';
  title?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'command-deck' as Tab, label: 'Command Deck', icon: Compass },
      { id: 'kanban' as Tab, label: 'Board', icon: LayoutGrid },
      { id: 'pipeline' as Tab, label: 'Pipeline', icon: GitBranch },
      { id: 'awaiting-merge' as Tab, label: 'Awaiting Merge', icon: GitMerge },
      { id: 'agents' as Tab, label: 'Agents', icon: Bot },
      { id: 'autopreso' as Tab, label: 'AutoPreso', icon: Mic },
      { id: 'flywheel' as Tab, label: 'Flywheel', icon: Loader2, badge: 'flywheel-live' },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'resources' as Tab, label: 'Resources', icon: Server },
    ],
  },
  {
    label: 'Observability',
    items: [
      { id: 'activity' as Tab, label: 'Activity', icon: Terminal },
      { id: 'sessions' as Tab, label: 'Sessions', icon: History },
      { id: 'metrics' as Tab, label: 'Metrics', icon: BarChart3 },
      { id: 'costs' as Tab, label: 'Costs', icon: DollarSign },
      { id: 'health' as Tab, label: 'Health', icon: HeartPulse },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'skills' as Tab, label: 'Skills', icon: Cpu },
      { id: 'settings' as Tab, label: 'Settings', icon: Settings },
      { id: 'god-view' as Tab, label: 'God View', icon: Zap },
    ],
  },
];

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onSearchOpen: () => void;
}

export function Sidebar({ activeTab, onTabChange, onSearchOpen }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: versionData } = useQuery({
    queryKey: ['version'],
    queryFn: async () => {
      const res = await fetch('/api/version');
      if (!res.ok) return null;
      return res.json() as Promise<{ version: string; isDev?: boolean }>;
    },
    staleTime: Infinity,
  });

  const isDev = versionData?.isDev ?? false;

  const { data: flywheelRunsRaw } = useQuery({
    queryKey: ['flywheel-runs'],
    queryFn: async () => {
      const res = await fetch('/api/flywheel/runs?limit=10');
      if (!res.ok) return [];
      return res.json() as Promise<FlywheelRunSummary[]>;
    },
    refetchInterval: 5000,
  });
  const flywheelRuns = Array.isArray(flywheelRunsRaw) ? flywheelRunsRaw : [];
  const hasActiveFlywheelRun = flywheelRuns.some((run) => run.status === 'running');

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/dev/rebuild', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Build failed');
      return data;
    },
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  // Keyboard shortcut: [ to toggle collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '[' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        toggleCollapsed();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleCollapsed]);

  return (
    <>
      {/* Mobile hamburger button — only visible on small screens */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          flex flex-col shrink-0 bg-card border-r border-border
          transition-all duration-200 ease-in-out overflow-hidden
          fixed md:relative inset-y-0 left-0 z-40
          ${collapsed ? 'w-12' : 'w-64'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        {/* ─── Header: Logo + Collapse button ─── */}
        <div className="flex items-center justify-between h-12 px-3 shrink-0 border-b border-border">
          {!collapsed && (
            <button
              onClick={() => onTabChange('pipeline')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
              title="Go to Pipeline"
            >
              <Eye className="w-5 h-5 text-primary shrink-0" />
              {/* PAN-698: Space Grotesk is reserved for the sidebar wordmark only */}
              <span className="text-base font-semibold text-foreground font-display truncate">
                Panopticon
              </span>
              {versionData?.version && (
                <span className="text-[10px] text-muted-foreground font-normal">v{versionData.version}</span>
              )}
            </button>
          )}
          {collapsed && (
            <button
              onClick={() => onTabChange('pipeline')}
              className="flex items-center justify-center w-full hover:opacity-80 transition-opacity"
              title="Go to Pipeline"
            >
              <Eye className="w-5 h-5 text-primary" />
            </button>
          )}
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
              title="Collapse sidebar ([)"
              data-testid="sidebar-collapse"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ─── Nav groups ─── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-hide">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className={collapsed ? 'mb-2' : 'mb-1'}>
              {!collapsed && (
                <p className="px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-1 first:mt-2">
                  {group.label}
                </p>
              )}
              {collapsed && <div className="h-px mx-2 bg-border my-2" />}
              {group.items.map(({ id, label, icon: Icon, badge, title }) => {
                const isActive = activeTab === id;
                const liveBadge = badge === 'flywheel-live' && hasActiveFlywheelRun;
                return (
                  <button
                    key={id}
                    onClick={() => { onTabChange(id); setMobileOpen(false); }}
                    title={title ?? (collapsed ? label : undefined)}
                    data-testid={`sidebar-${id}`}
                    className={`
                      w-full flex items-center gap-3 transition-colors duration-150 text-sm font-medium
                      ${collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-1.5'}
                      ${isActive
                        ? 'bg-accent text-foreground border-l-2 border-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground border-l-2 border-transparent'
                      }
                    `}
                  >
                    <Icon className={`shrink-0 ${collapsed ? 'w-4 h-4' : 'w-4 h-4'}`} />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && liveBadge && (
                      <span className="ml-auto rounded-full border border-success/30 bg-success/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
                        live
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ─── Footer: Status + Search + Theme toggle ─── */}
        <div className="shrink-0 border-t border-border">
          {!collapsed && (
            <div className="px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <CloisterStatusBar onOpenSettings={() => onTabChange('settings')} />
                <div className="ml-auto">
                  <FreshnessIndicator />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onSearchOpen}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Search (press /)"
                  data-testid="sidebar-search"
                >
                  <span>Search</span>
                  <kbd className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                    /
                  </kbd>
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <DeaconPauseToggle />
                  {isDev && (
                    <button
                      onClick={() => rebuildMutation.mutate()}
                      disabled={rebuildMutation.isPending}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      title={rebuildMutation.isPending ? 'Building...' : 'Rebuild Panopticon (npm run build)'}
                      data-testid="sidebar-rebuild"
                    >
                      {rebuildMutation.isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Hammer className="w-4 h-4" />}
                    </button>
                  )}
                  <button
                    onClick={toggleTheme}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                    data-testid="sidebar-theme"
                  >
                    {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  isDev
                    ? 'bg-amber-500/15 text-amber-500'
                    : 'bg-emerald-500/15 text-emerald-500'
                }`}>
                  {isDev ? 'DEV' : 'PROD'}
                </span>
                {rebuildMutation.isSuccess && (
                  <span className="text-[10px] text-emerald-500">Build complete</span>
                )}
                {rebuildMutation.isError && (
                  <span className="text-[10px] text-destructive" title={(rebuildMutation.error as Error)?.message}>
                    Build failed
                  </span>
                )}
              </div>
            </div>
          )}
          {collapsed && (
            <div className="flex flex-col items-center gap-1 py-2">
              <span className={`text-[8px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded ${
                isDev
                  ? 'bg-amber-500/15 text-amber-500'
                  : 'bg-emerald-500/15 text-emerald-500'
              }`}>
                {isDev ? 'DEV' : 'PROD'}
              </span>
              {isDev && (
                <button
                  onClick={() => rebuildMutation.mutate()}
                  disabled={rebuildMutation.isPending}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                  title={rebuildMutation.isPending ? 'Building...' : 'Rebuild'}
                  data-testid="sidebar-rebuild"
                >
                  {rebuildMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Hammer className="w-3.5 h-3.5" />}
                </button>
              )}
              <DeaconPauseToggle compact />
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                data-testid="sidebar-theme"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={toggleCollapsed}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Expand sidebar ([)"
                data-testid="sidebar-collapse"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
