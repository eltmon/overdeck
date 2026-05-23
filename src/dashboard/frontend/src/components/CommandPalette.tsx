/**
 * Cmd+K command palette for Panopticon.
 *
 * Opens on Cmd+K (macOS) / Ctrl+K (Linux/Windows).
 * Also opened from the desktop app via panopticonBridge.onMenuAction.
 *
 * Sections (in display order):
 *   - Actions / Orchestration / Navigation  — built-in dashboard actions
 *   - Commands                              — curated `pan <verb>` catalog (click to copy)
 *   - Active Workspaces / Issues / Running Agents
 *   - Memory / Observations                 — FTS over ~/.panopticon/memory
 *
 * Phase 2 (tracked separately) will add semantic conversation search with
 * excerpts that point to the relevant message inside a JSONL session.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { toast } from 'sonner';
import {
  Play,
  Square,
  AlertTriangle,
  Settings,
  Terminal,
  FolderOpen,
  User,
  Zap,
  Bot,
  RefreshCw,
  ChevronRight,
  Brain,
  Sparkles,
  Eye,
} from 'lucide-react';
import { isAgentRunningStatus } from '../lib/pipeline-state';
import { useDashboardStore, selectAgents, selectIssues } from '../lib/store';
import type { Issue, Agent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  group: string;
  keywords?: string[];
  onSelect: () => void;
  destructive?: boolean;
  // Optional rich excerpt rendering (memory/observation results).
  excerptSegments?: ExcerptSegment[];
  // Sort hint within group: lower = earlier.
  rank?: number;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string, issueId?: string) => void;
}

interface PanCommandEntry {
  name: string;
  description: string;
  group: string;
  keywords?: string[];
}

type ExcerptSegment = { kind: 'text' | 'match'; value: string };

interface PaletteSearchHit {
  kind: 'memory' | 'observation' | 'summary';
  id: string;
  projectId: string;
  workspaceId: string;
  issueId: string;
  timestamp: string;
  displayContent: string;
  excerpt: string;
  excerptSegments: ExcerptSegment[];
  tags: string[];
  docType: string;
  rank: number;
}

interface PaletteSearchResponse {
  memory: PaletteSearchHit[];
  observations: PaletteSearchHit[];
  summaries: PaletteSearchHit[];
}

const EMPTY_AGENTS: Agent[] = [];
const EMPTY_ISSUES: Issue[] = [];
const EMPTY_SEARCH: PaletteSearchResponse = { memory: [], observations: [], summaries: [] };

// ─── Server API ───────────────────────────────────────────────────────────────

async function callApi(path: string, method = 'POST'): Promise<void> {
  try {
    await fetch(path, { method });
  } catch {
    console.error(`[command-palette] API call failed: ${method} ${path}`);
  }
}

async function fetchPanCommands(): Promise<PanCommandEntry[]> {
  try {
    const res = await fetch('/api/palette/commands');
    if (!res.ok) return [];
    const data = await res.json() as { commands?: PanCommandEntry[] };
    return Array.isArray(data.commands) ? data.commands : [];
  } catch {
    return [];
  }
}

async function fetchPaletteSearch(query: string, signal: AbortSignal): Promise<PaletteSearchResponse> {
  try {
    const res = await fetch(`/api/palette/search?q=${encodeURIComponent(query)}&limit=15`, { signal });
    if (!res.ok) return EMPTY_SEARCH;
    const data = await res.json() as PaletteSearchResponse;
    return {
      memory: data.memory ?? [],
      observations: data.observations ?? [],
      summaries: data.summaries ?? [],
    };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return EMPTY_SEARCH;
    return EMPTY_SEARCH;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Highlighted text ─────────────────────────────────────────────────────────
//
// Wraps every case-insensitive occurrence of any query term in `text` with a
// <mark>. Used for label + description on every palette row so the matched
// substring is visually obvious. Memory excerpts keep their server-driven
// FTS5 snippet highlighting (which understands stemming).

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHighlightTerms(query: string): string[] {
  const matches = query.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const dedup = new Set<string>();
  for (const term of matches) {
    if (term.length === 0) continue;
    dedup.add(term);
  }
  // Match longer terms first so a query like "pan plan" highlights "plan"
  // inside "planning" before "pan" greedily consumes part of "planning".
  return [...dedup].sort((a, b) => b.length - a.length);
}

interface HighlightedProps {
  text: string;
  terms: string[];
}

// Spans (not <mark>) avoid the browser's bright-yellow default style.
// Theme-aware highlight:
//   - light mode: soft amber-200 backdrop with dark amber-900 text
//     (marker-pen feel on a white surface)
//   - dark mode: translucent amber backdrop with light amber-200 text
//     (subtle warm accent that doesn't shout against the dark surface)
const HIGHLIGHT_CLASS =
  'rounded-sm px-px bg-amber-200/70 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200';

function Highlighted({ text, terms }: HighlightedProps) {
  if (!text) return null;
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={HIGHLIGHT_CLASS}>{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 120);
  const agents = useDashboardStore((state) => isOpen ? selectAgents(state) : EMPTY_AGENTS) as unknown as Agent[];
  const issues = useDashboardStore((state) => isOpen ? selectIssues(state) : EMPTY_ISSUES) as Issue[];
  const openIssue = useDashboardStore((state) => state.openIssue);

  const [panCommands, setPanCommands] = useState<PanCommandEntry[]>([]);
  const [searchResults, setSearchResults] = useState<PaletteSearchResponse>(EMPTY_SEARCH);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  // Reset query when opened, and lazy-load the pan command catalog the first
  // time the palette is shown.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSearchResults(EMPTY_SEARCH);
    if (panCommands.length === 0) {
      void fetchPanCommands().then(setPanCommands);
    }
  }, [isOpen, panCommands.length]);

  // Fan out to the unified search endpoint as the user types.
  useEffect(() => {
    if (!isOpen) return;
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults(EMPTY_SEARCH);
      setIsSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsSearchLoading(true);
    void fetchPaletteSearch(trimmed, controller.signal)
      .then((data) => setSearchResults(data))
      .finally(() => setIsSearchLoading(false));
    return () => controller.abort();
  }, [isOpen, debouncedQuery]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const handleSelect = useCallback((action: () => void) => {
    onClose();
    // Small delay so modal closes before action side effects
    setTimeout(action, 50);
  }, [onClose]);

  // ─── Action builders (stable wrt query — filtered later) ────────────────────

  const staticActions = useMemo<PaletteAction[]>(() => [
    {
      id: 'pan-flywheel',
      label: 'Run flywheel',
      description: 'Start the autonomous pipeline run on all In Progress / In Review issues',
      icon: Zap,
      group: 'Actions',
      keywords: ['flywheel', 'all-up', 'orchestrator', 'fixall', 'autonomous'],
      onSelect: () => onNavigate('flywheel'),
    },
    {
      id: 'start-cloister',
      label: 'Start Cloister',
      description: 'Enable autonomous agent orchestration',
      icon: Play,
      group: 'Orchestration',
      keywords: ['run', 'enable', 'activate'],
      onSelect: () => void callApi('/api/cloister/start'),
    },
    {
      id: 'stop-cloister',
      label: 'Stop Cloister',
      description: 'Disable autonomous agent orchestration',
      icon: Square,
      group: 'Orchestration',
      keywords: ['pause', 'disable', 'halt'],
      onSelect: () => void callApi('/api/cloister/stop'),
    },
    {
      id: 'emergency-stop',
      label: 'Emergency Stop All Agents',
      description: 'Immediately stop all running agents',
      icon: AlertTriangle,
      group: 'Orchestration',
      keywords: ['kill', 'abort', 'stop all', 'halt'],
      destructive: true,
      onSelect: () => void callApi('/api/agents/emergency-stop'),
    },
    {
      id: 'restart-conversations',
      label: 'Restart All Conversations',
      description: 'Re-spawn all active conversations with their stored model',
      icon: RefreshCw,
      group: 'Orchestration',
      keywords: ['restart', 'respawn', 'conversations', 'model', 'refresh'],
      onSelect: () => void callApi('/api/conversations/restart-all'),
    },
    {
      id: 'restart-agents',
      label: 'Restart All Workspace Agents',
      description: 'Stop and re-start all running workspace agents',
      icon: RefreshCw,
      group: 'Orchestration',
      keywords: ['restart', 'respawn', 'agents', 'workspace', 'refresh'],
      onSelect: () => void callApi('/api/agents/restart-all'),
    },
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Configure models, providers, and agent behavior',
      icon: Settings,
      group: 'Navigation',
      keywords: ['preferences', 'config', 'configure'],
      onSelect: () => onNavigate('settings'),
    },
    {
      id: 'open-kanban',
      label: 'Go to Kanban Board',
      description: 'View issues and agent status',
      icon: FolderOpen,
      group: 'Navigation',
      keywords: ['board', 'issues', 'home'],
      onSelect: () => onNavigate('kanban'),
    },
    {
      id: 'open-terminal',
      label: 'Open Terminal',
      description: 'Access the Panopticon terminal',
      icon: Terminal,
      group: 'Navigation',
      keywords: ['shell', 'console'],
      onSelect: () => onNavigate('command-deck'),
    },
    {
      id: 'open-agents',
      label: 'View Agents',
      description: 'See all running and completed agents',
      icon: Bot,
      group: 'Navigation',
      keywords: ['agents', 'workers'],
      onSelect: () => onNavigate('agents'),
    },
  ], [onNavigate]);

  // ─── Dynamic: issues + agents ─────────────────────────────────────────────

  const { issueActions, agentActions } = useMemo(() => {
    const activeAgents = agents.filter((agent) => isAgentRunningStatus(agent.status));
    const activeIssueIds = new Set(activeAgents.map((a) => a.issueId?.toLowerCase()).filter(Boolean));
    const branchByIssueId = new Map(
      activeAgents
        .filter((agent) => agent.issueId && agent.git?.branch)
        .map((agent) => [agent.issueId!.toLowerCase(), agent.git!.branch]),
    );

    const issueActs: PaletteAction[] = issues.map((issue) => {
      const issueKey = issue.identifier.toLowerCase();
      const branch = branchByIssueId.get(issueKey);
      const active = activeIssueIds.has(issueKey);
      return {
        id: `issue-${issue.identifier}`,
        label: issue.identifier,
        description: branch ? `${issue.title} · ${branch}` : issue.title,
        icon: FolderOpen,
        group: active ? 'Active Workspaces' : 'Issues',
        keywords: [issue.id, issue.identifier, issue.title, branch ?? '', issue.workspacePath ?? ''].filter(Boolean),
        onSelect: () => {
          openIssue(issue.identifier);
        },
      };
    });

    const agentActs: PaletteAction[] = activeAgents.map((agent) => ({
      id: `agent-${agent.id}`,
      label: agent.issueId ?? agent.id,
      description: agent.issueId ? `Working on ${agent.issueId}` : agent.status,
      icon: User,
      group: 'Running Agents',
      keywords: [agent.id, agent.issueId ?? '', agent.git?.branch ?? '', agent.status],
      onSelect: () => {
        if (agent.issueId) openIssue(agent.issueId);
        else onNavigate('agents');
      },
    }));

    return { issueActions: issueActs, agentActions: agentActs };
  }, [agents, issues, openIssue, onNavigate]);

  // ─── Dynamic: pan commands ────────────────────────────────────────────────

  const commandActions = useMemo<PaletteAction[]>(() => panCommands.map((cmd, index) => ({
    id: `cmd-${index}-${cmd.name}`,
    label: cmd.name,
    description: cmd.description,
    icon: ChevronRight,
    group: `Commands · ${cmd.group}`,
    keywords: ['pan', cmd.group, ...(cmd.keywords ?? [])],
    onSelect: () => {
      void copyToClipboard(cmd.name).then((ok) => {
        if (ok) toast.success(`Copied: ${cmd.name}`);
        else toast.error('Clipboard unavailable — copy manually');
      });
    },
  })), [panCommands]);

  // ─── Dynamic: memory + observations + summaries ───────────────────────────

  const memoryActions = useMemo<PaletteAction[]>(() => {
    const out: PaletteAction[] = [];
    const push = (hits: PaletteSearchHit[], group: string, icon: React.ElementType) => {
      for (const hit of hits) {
        const label = hit.displayContent || hit.docType || hit.id;
        const issueOrProject = hit.issueId || hit.projectId || '';
        const when = hit.timestamp ? hit.timestamp.slice(0, 16).replace('T', ' ') : '';
        const meta = [issueOrProject, when].filter(Boolean).join(' · ');
        out.push({
          id: `mem-${hit.kind}-${hit.id}`,
          label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
          description: meta,
          icon,
          group,
          rank: hit.rank,
          excerptSegments: hit.excerptSegments,
          keywords: [hit.kind, hit.docType, hit.projectId, hit.issueId, ...hit.tags],
          onSelect: () => {
            if (hit.issueId && /^[A-Z]+-\d+$/i.test(hit.issueId)) {
              openIssue(hit.issueId);
            } else {
              toast.message(label, { description: hit.excerpt || meta || undefined });
            }
          },
        });
      }
    };
    push(searchResults.observations, 'Observations', Eye);
    push(searchResults.memory, 'Memory', Brain);
    push(searchResults.summaries, 'Memory · Summaries', Sparkles);
    return out;
  }, [searchResults, openIssue]);

  // ─── Filter + group ───────────────────────────────────────────────────────

  const allActions = useMemo(() => [
    ...staticActions,
    ...commandActions,
    ...issueActions,
    ...agentActions,
    ...memoryActions,
  ], [staticActions, commandActions, issueActions, agentActions, memoryActions]);

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      // Default view: only show built-in actions + issues + agents. Don't
      // dump the entire pan command catalog or empty memory section.
      return allActions.filter((a) => !a.group.startsWith('Commands · '));
    }
    const q = trimmed.toLowerCase();
    return allActions.filter((action) => {
      // Server-side memory results are pre-matched against the query, so
      // include them unconditionally (sort handles ranking).
      if (action.group === 'Memory' || action.group === 'Observations' || action.group === 'Memory · Summaries') {
        return true;
      }
      return (
        action.label.toLowerCase().includes(q) ||
        (action.description?.toLowerCase().includes(q) ?? false) ||
        (action.keywords?.some((k) => k.toLowerCase().includes(q)) ?? false)
      );
    });
  }, [query, allActions]);

  // Terms used to highlight every matched substring in label + description.
  const highlightTerms = useMemo(() => extractHighlightTerms(query), [query]);

  // Display group ordering: Actions/Orchestration/Navigation first, then
  // Active Workspaces, Issues, Running Agents, Commands, Memory/Observations.
  const groupOrder = useMemo(() => {
    const seen = new Set(filtered.map((a) => a.group));
    const ordered: string[] = [];
    const preferred = ['Actions', 'Orchestration', 'Navigation', 'Active Workspaces', 'Issues', 'Running Agents'];
    for (const g of preferred) if (seen.has(g)) { ordered.push(g); seen.delete(g); }
    const commandGroups = [...seen].filter((g) => g.startsWith('Commands · ')).sort();
    for (const g of commandGroups) { ordered.push(g); seen.delete(g); }
    for (const g of ['Observations', 'Memory', 'Memory · Summaries']) if (seen.has(g)) { ordered.push(g); seen.delete(g); }
    ordered.push(...seen);
    return ordered;
  }, [filtered]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-border">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search commands, issues, memory, observations…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              autoFocus
            />
            {isSearchLoading && (
              <span className="text-[10px] text-muted-foreground">searching…</span>
            )}
            <kbd className="text-[10px] text-muted-foreground bg-card px-1.5 py-0.5 rounded border border-border">ESC</kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[480px] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                {query.trim().length === 0 ? 'Start typing…' : `No results for "${query}"`}
              </Command.Empty>
            ) : (
              groupOrder.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
                >
                  {filtered
                    .filter((a) => a.group === group)
                    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                    .map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.id}
                        onSelect={() => handleSelect(action.onSelect)}
                        className="flex items-start gap-3 px-3 py-2 mx-1 rounded-lg cursor-pointer data-[selected=true]:bg-popover transition-colors group"
                      >
                        <div className={`size-7 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                          action.destructive
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-card text-muted-foreground group-data-[selected=true]:text-primary'
                        }`}>
                          <action.icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${
                            action.destructive ? 'text-destructive' : 'text-foreground'
                          }`}>
                            <Highlighted text={action.label} terms={highlightTerms} />
                          </p>
                          {action.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              <Highlighted text={action.description} terms={highlightTerms} />
                            </p>
                          )}
                          {action.excerptSegments && action.excerptSegments.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
                              {action.excerptSegments.map((seg, i) =>
                                seg.kind === 'match' ? (
                                  <span key={i} className={HIGHLIGHT_CLASS}>{seg.value}</span>
                                ) : (
                                  <span key={i}>{seg.value}</span>
                                ),
                              )}
                            </p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                </Command.Group>
              ))
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-card">
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-card border border-border rounded text-[9px]">↑↓</kbd>
              navigate
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-card border border-border rounded text-[9px]">↵</kbd>
              select
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-card border border-border rounded text-[9px]">Esc</kbd>
              close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
