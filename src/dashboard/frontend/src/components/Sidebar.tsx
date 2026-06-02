import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Eye, Home, LayoutGrid, Bot, Server,
  Terminal, BarChart3, DollarSign, HeartPulse, Cpu, Settings,
  Zap, Compass, GitBranch, GitMerge, ChevronsLeft, ChevronsRight, Sun, Moon, Menu,
  Hammer, Loader2, History, Mic, FileText, ChevronDown, ChevronRight, MoreHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { fetchProjects, isUnscopedConversation, NO_PROJECT_KEY, NO_PROJECT_LABEL, type RegisteredProjectLite } from './CommandDeck/projectsData';
import { fetchConversations } from './CommandDeck/ConversationList';
import { FreshnessIndicator } from './FreshnessIndicator';
import { useTheme } from '../hooks/useTheme';
import { useDashboardStore, selectIssues, selectAgents } from '../lib/store';
import { getPipelineIssuePhase } from '../lib/pipeline-state';
import type { Issue, Agent } from '../types';
import type { Tab } from './Header';

type PipelineIssuePhase = 'ship' | 'review' | 'work' | 'plan' | 'todo';
const PIPELINE_PHASES: PipelineIssuePhase[] = ['todo', 'plan', 'work', 'review', 'ship'];

const PHASE_LABELS: Record<PipelineIssuePhase, string> = {
  ship: 'Ship', review: 'Review', work: 'Work', plan: 'Plan', todo: 'Todo',
};

const PHASE_DOT_CLASSES: Record<PipelineIssuePhase, string> = {
  ship: 'bg-success', review: 'bg-warning', work: 'bg-info',
  plan: 'bg-signal-review', todo: 'bg-muted-foreground/30',
};

function isClosedIssue(issue: Issue) {
  const state = issue.state ?? issue.status;
  return issue.stateType === 'completed' || issue.stateType === 'canceled' || state === 'done' || state === 'canceled' || state === 'Canceled' || state === 'Closed' || state === 'Completed';
}

function readPipelineFilterState() {
  if (typeof window === 'undefined') return { phase: 'all' as const, projects: [] as string[] };
  const params = new URLSearchParams(window.location.search);
  const phaseParam = params.get('phase');
  const phase = (PIPELINE_PHASES as string[]).includes(phaseParam ?? '') ? phaseParam as PipelineIssuePhase : 'all' as const;
  const projects = params.get('projects')?.split(',').map((p) => p.trim()).filter(Boolean) ?? [];
  return { phase, projects };
}

function setPipelineFilterUrl(key: 'phase' | 'projects', value: string | null) {
  const url = new URL(window.location.href);
  if (value === null || value === '') {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, value);
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const SIDEBAR_STORAGE_KEY = 'panopticon.ui.sidebarCollapsed';

interface FlywheelRunSummary {
  id: string;
  status: 'running' | 'paused' | 'complete' | 'aborted';
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

// PAN-1561: the primary rail is Home · Flywheel · Projects. Everything else
// moves into the collapsible "More" section (MORE_GROUPS) below the Projects
// list — every route stays reachable, no feature is lost.
const PRIMARY_ITEMS: NavItem[] = [
  { id: 'home' as Tab, label: 'Home', icon: Home },
  { id: 'flywheel' as Tab, label: 'Flywheel', icon: Loader2, badge: 'flywheel-live' },
];

const MORE_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'command-deck' as Tab, label: 'Command Deck', icon: Compass },
      { id: 'kanban' as Tab, label: 'Board', icon: LayoutGrid },
      { id: 'pipeline' as Tab, label: 'Pipeline', icon: GitBranch },
      { id: 'awaiting-merge' as Tab, label: 'Awaiting Merge', icon: GitMerge },
      { id: 'agents' as Tab, label: 'Agents', icon: Bot },
      { id: 'autopreso' as Tab, label: 'AutoPreso', icon: Mic },
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
      { id: 'context' as Tab, label: 'Context', icon: FileText },
      { id: 'settings' as Tab, label: 'Settings', icon: Settings },
      { id: 'god-view' as Tab, label: 'God View', icon: Zap },
    ],
  },
];

const MORE_COLLAPSED_KEY = 'panopticon.ui.sidebarMoreCollapsed';

interface SidebarProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onSearchOpen: () => void;
  /** PAN-1561: the project whose deck is open (rail highlight). */
  selectedProject?: string | null;
  /** PAN-1561: open a project's deck from the rail. */
  onSelectProject?: (projectName: string) => void;
}

export function Sidebar({ activeTab, onTabChange, onSearchOpen, selectedProject = null, onSelectProject }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  });
  const [moreCollapsed, setMoreCollapsed] = useState(() => {
    return localStorage.getItem(MORE_COLLAPSED_KEY) === 'true';
  });
  const toggleMoreCollapsed = useCallback(() => {
    setMoreCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(MORE_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);

  // PAN-1561: project rail — shares the `command-deck-projects` query with the
  // CommandDeck so the list is deduped and consistent.
  const { data: projects = [] } = useQuery({
    queryKey: ['command-deck-projects'],
    queryFn: fetchProjects,
    refetchInterval: 30000,
  });

  // PAN-1561: the "No project" bucket appears once a conversation exists that
  // isn't under any registered project. These queries share keys with the
  // CommandDeck (react-query dedupes — no extra network).
  const { data: sidebarConversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: async (): Promise<RegisteredProjectLite[]> => {
      const res = await fetch('/api/registered-projects');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60000,
  });
  const hasUnscopedConversations = useMemo(
    () => sidebarConversations.some((c) => isUnscopedConversation(c, registeredProjects)),
    [sidebarConversations, registeredProjects],
  );

  const issues = useDashboardStore(selectIssues) as Issue[];
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const [pipelineFilter, setPipelineFilter] = useState(readPipelineFilterState);

  useEffect(() => {
    const handlePopState = () => setPipelineFilter(readPipelineFilterState());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const pipelineData = useMemo(() => {
    if (activeTab !== 'pipeline') return { phaseCounts: {} as Record<string, number>, projects: [] as Array<{ id: string; name: string; color: string; prefix: string }> };

    const agentByIssueId = new Map<string, Agent>();
    for (const agent of agents) {
      const key = agent.issueId?.toLowerCase();
      if (key && !agentByIssueId.has(key)) agentByIssueId.set(key, agent);
    }

    const phaseCounts: Record<string, number> = { ship: 0, review: 0, work: 0, plan: 0, todo: 0 };
    const projectMap = new Map<string, { name: string; color: string; prefix: string }>();

    for (const issue of issues) {
      if (isClosedIssue(issue)) continue;
      const agent = agentByIssueId.get(issue.identifier.toLowerCase()) ?? null;
      const reviewStatus = reviewStatusByIssueId[issue.identifier] ?? reviewStatusByIssueId[issue.identifier.toUpperCase()];
      const phase = getPipelineIssuePhase(issue, reviewStatus, agent);
      phaseCounts[phase] = (phaseCounts[phase] ?? 0) + 1;
      if (issue.project) {
        const id = issue.project.id || issue.project.name;
        if (!projectMap.has(id)) {
          const prefix = issue.identifier.includes('-') ? issue.identifier.split('-')[0].toUpperCase() : '';
          projectMap.set(id, { name: issue.project.name, color: issue.project.color ?? '', prefix });
        }
      }
    }

    const projects = Array.from(projectMap.entries())
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { phaseCounts, projects };
  }, [activeTab, issues, agents, reviewStatusByIssueId]);
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

  const renderNavItem = ({ id, label, icon: Icon, badge, title }: NavItem) => {
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
        <Icon className="shrink-0 w-4 h-4" />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && liveBadge && (
          <span className="ml-auto rounded-full border border-success/30 bg-success/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success">
            live
          </span>
        )}
      </button>
    );
  };

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
              onClick={() => onTabChange('home')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
              title="Go to Home"
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
              onClick={() => onTabChange('home')}
              className="flex items-center justify-center w-full hover:opacity-80 transition-opacity"
              title="Go to Home"
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

        {/* ─── Nav: Home · Flywheel · Projects · More (PAN-1561) ─── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-hide">
          {/* Primary rail */}
          <div className={collapsed ? 'mb-2' : 'mb-1'}>
            {PRIMARY_ITEMS.map(renderNavItem)}
          </div>

          {/* ─── Projects ─── */}
          {!collapsed ? (
            <div className="mb-1" data-testid="sidebar-projects">
              <p className="px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-1">
                Projects
              </p>
              {projects.length === 0 ? (
                <p className="px-3 py-1.5 text-xs text-muted-foreground/70">No projects</p>
              ) : (
                projects.map((project) => {
                  const isActive = activeTab === 'command-deck' && selectedProject === project.name;
                  const hasActivity = project.features.length > 0;
                  return (
                    <button
                      key={project.path}
                      onClick={() => { onSelectProject?.(project.name); setMobileOpen(false); }}
                      title={project.name}
                      data-testid={`sidebar-project-${project.name}`}
                      className={`
                        w-full flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 text-sm font-medium border-l-2
                        ${isActive
                          ? 'bg-accent text-foreground border-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent'
                        }
                      `}
                    >
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${hasActivity ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{project.name}</span>
                      {project.features.length > 0 && (
                        <span className="ml-auto text-[11px] text-muted-foreground">{project.features.length}</span>
                      )}
                    </button>
                  );
                })
              )}
              {/* No-project bucket — unscoped conversations/terminals (PAN-1561) */}
              {hasUnscopedConversations && (
                <button
                  onClick={() => { onSelectProject?.(NO_PROJECT_KEY); setMobileOpen(false); }}
                  title={NO_PROJECT_LABEL}
                  data-testid="sidebar-project-no-project"
                  className={`
                    w-full flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 text-sm font-medium border-l-2
                    ${activeTab === 'command-deck' && selectedProject === NO_PROJECT_KEY
                      ? 'bg-accent text-foreground border-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent'
                    }
                  `}
                >
                  <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/30" aria-hidden="true" />
                  <span className="truncate italic">{NO_PROJECT_LABEL}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="h-px mx-2 bg-border my-2" />
          )}

          {/* ─── More (collapsible) — every other view (PAN-1561) ─── */}
          {!collapsed ? (
            <div className="mb-1" data-testid="sidebar-more">
              <button
                type="button"
                onClick={toggleMoreCollapsed}
                aria-expanded={!moreCollapsed}
                className="w-full flex items-center gap-1.5 px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-1 hover:text-foreground transition-colors"
              >
                {moreCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <MoreHorizontal className="w-3 h-3" />
                More
              </button>
              {!moreCollapsed && MORE_GROUPS.map((group) => (
                <div key={group.label} className="mb-1">
                  <p className="px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70 mt-3 mb-1">
                    {group.label}
                  </p>
                  {group.items.map(renderNavItem)}
                </div>
              ))}
            </div>
          ) : (
            MORE_GROUPS.map((group) => (
              <div key={group.label} className="mb-2">
                <div className="h-px mx-2 bg-border my-2" />
                {group.items.map(renderNavItem)}
              </div>
            ))
          )}

          {/* ─── Pipeline filter groups ─── */}
          {!collapsed && activeTab === 'pipeline' && (
            <>
              <div className="mb-1" data-testid="sidebar-pipeline-phases">
                <p className="px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-1">
                  Filter phase
                </p>
                <button
                  type="button"
                  data-testid="sidebar-phase-all"
                  onClick={() => { setPipelineFilterUrl('phase', null); setPipelineFilter(readPipelineFilterState); }}
                  className={`w-full flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 text-sm font-medium border-l-2 ${pipelineFilter.phase === 'all' ? 'bg-accent text-foreground border-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent'}`}
                >
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
                  <span className="truncate">All phases</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {Object.values(pipelineData.phaseCounts).reduce((s, n) => s + n, 0)}
                  </span>
                </button>
                {PIPELINE_PHASES.map((phase) => (
                  <button
                    key={phase}
                    type="button"
                    data-testid={`sidebar-phase-${phase}`}
                    onClick={() => { setPipelineFilterUrl('phase', phase); setPipelineFilter(readPipelineFilterState); }}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 text-sm font-medium border-l-2 ${pipelineFilter.phase === phase ? 'bg-accent text-foreground border-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent'}`}
                  >
                    <span className={`h-2 w-2 rounded-full shrink-0 ${PHASE_DOT_CLASSES[phase]}`} />
                    <span className="truncate">{PHASE_LABELS[phase]}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {pipelineData.phaseCounts[phase] ?? 0}
                    </span>
                  </button>
                ))}
              </div>
              {pipelineData.projects.length > 0 && (
                <div className="mb-1" data-testid="sidebar-pipeline-projects">
                  <p className="px-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-1">
                    Projects
                  </p>
                  {pipelineData.projects.map((project) => {
                    const isSelected = pipelineFilter.projects.includes(project.id);
                    const toggle = () => {
                      const next = isSelected
                        ? pipelineFilter.projects.filter((p) => p !== project.id)
                        : [...pipelineFilter.projects, project.id];
                      setPipelineFilterUrl('projects', next.length > 0 ? next.join(',') : null);
                      setPipelineFilter(readPipelineFilterState);
                    };
                    return (
                      <button
                        key={project.id}
                        type="button"
                        data-testid={`sidebar-project-${project.id}`}
                        onClick={toggle}
                        aria-pressed={isSelected}
                        className={`w-full flex items-center gap-3 px-3 py-1.5 transition-colors duration-150 text-sm font-medium border-l-2 ${isSelected ? 'bg-accent text-foreground border-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground border-transparent'}`}
                      >
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: project.color || 'currentColor' }}
                        />
                        <span className="truncate">{project.name}</span>
                        {project.prefix && (
                          <span className="ml-auto text-[11px] text-muted-foreground font-mono">{project.prefix}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </nav>

        {/* ─── Footer: Status + Search + Theme toggle ─── */}
        <div className="shrink-0 border-t border-border">
          {!collapsed && (
            <div className="px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                {/* Cloister system controls moved to the top app-bar SystemMenu (PAN-1605). */}
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
                  {/* Deacon Freeze/Resume moved to the top app bar (PAN-1607). */}
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
