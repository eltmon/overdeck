/**
 * Cmd+K command palette for Panopticon.
 *
 * Opens on Cmd+K (macOS) / Ctrl+K (Linux/Windows).
 * Also opened from the desktop app via panopticonBridge.onMenuAction.
 *
 * Sections:
 *   - Actions: Start/Stop Cloister, Emergency Stop, Open Settings, Plan Issue
 *   - Workspaces: active workspaces (navigates to kanban + selects issue)
 *   - Agents: running agents (shows agent status)
 *   - Settings: jumps to settings subsections
 */

import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
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
} from 'lucide-react';
import { useDashboardStore } from '../lib/store';

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
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string, issueId?: string) => void;
}

// ─── Server API ───────────────────────────────────────────────────────────────

async function callApi(path: string, method = 'POST'): Promise<void> {
  try {
    await fetch(path, { method });
  } catch {
    console.error(`[command-palette] API call failed: ${method} ${path}`);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const agents = useDashboardStore((s) => s.agents);
  const issues = useDashboardStore((s) => s.issues);

  // Reset query when opened
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

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

  // ─── Static actions ─────────────────────────────────────────────────────────

  const staticActions: PaletteAction[] = [
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
      onSelect: () => onNavigate('terminal'),
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
  ];

  // ─── Dynamic: active workspaces ─────────────────────────────────────────────

  const activeAgents = agents.filter((a) => a.status !== 'dead');
  const activeIssueIds = new Set(activeAgents.map((a) => a.issueId?.toLowerCase()).filter(Boolean));

  const workspaceActions: PaletteAction[] = issues
    .filter((issue) => activeIssueIds.has(issue.identifier.toLowerCase()))
    .map((issue) => ({
      id: `workspace-${issue.identifier}`,
      label: issue.identifier,
      description: issue.title,
      icon: FolderOpen,
      group: 'Active Workspaces',
      keywords: [issue.identifier.toLowerCase(), issue.title.toLowerCase()],
      onSelect: () => {
        onNavigate('kanban', issue.identifier);
      },
    }));

  // ─── Dynamic: running agents ─────────────────────────────────────────────────

  const agentActions: PaletteAction[] = activeAgents.map((agent) => ({
    id: `agent-${agent.id}`,
    label: agent.name ?? agent.id,
    description: agent.issueId ? `Working on ${agent.issueId}` : agent.status,
    icon: User,
    group: 'Running Agents',
    keywords: [agent.name ?? '', agent.issueId ?? '', agent.status],
    onSelect: () => {
      if (agent.issueId) onNavigate('kanban', agent.issueId);
      else onNavigate('agents');
    },
  }));

  // ─── Filter ─────────────────────────────────────────────────────────────────

  const allActions = [...staticActions, ...workspaceActions, ...agentActions];

  const filtered = query.trim().length === 0
    ? allActions
    : allActions.filter((action) => {
        const q = query.toLowerCase();
        return (
          action.label.toLowerCase().includes(q) ||
          action.description?.toLowerCase().includes(q) ||
          action.keywords?.some((k) => k.toLowerCase().includes(q))
        );
      });

  // Group
  const groups = [...new Set(filtered.map((a) => a.group))];

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
        className="relative w-full max-w-xl bg-surface border border-divider-strong rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b [&_[cmdk-input-wrapper]]:border-divider">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-divider">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search actions, workspaces, agents…"
              className="flex-1 bg-transparent text-sm text-content-body placeholder:text-content-muted outline-none"
              autoFocus
            />
            <kbd className="text-[10px] text-content-muted bg-surface-emphasis px-1.5 py-0.5 rounded border border-divider">ESC</kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-[400px] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <Command.Empty className="py-6 text-center text-sm text-content-muted">
                No results for "{query}"
              </Command.Empty>
            ) : (
              groups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-content-muted"
                >
                  {filtered
                    .filter((a) => a.group === group)
                    .map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.id}
                        onSelect={() => handleSelect(action.onSelect)}
                        className="flex items-center gap-3 px-3 py-2 mx-1 rounded-lg cursor-pointer data-[selected=true]:bg-surface-overlay transition-colors group"
                      >
                        <div className={`size-7 rounded-md flex items-center justify-center shrink-0 ${
                          action.destructive
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-surface-emphasis text-content-subtle group-data-[selected=true]:text-primary'
                        }`}>
                          <action.icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${
                            action.destructive ? 'text-destructive' : 'text-content-body'
                          }`}>
                            {action.label}
                          </p>
                          {action.description && (
                            <p className="text-xs text-content-muted truncate">{action.description}</p>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                </Command.Group>
              ))
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-divider bg-surface-raised">
            <span className="text-[10px] text-content-muted flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-emphasis border border-divider rounded text-[9px]">↑↓</kbd>
              navigate
            </span>
            <span className="text-[10px] text-content-muted flex items-center gap-1">
              <kbd className="px-1 py-0.5 bg-surface-emphasis border border-divider rounded text-[9px]">↵</kbd>
              select
            </span>
            <span className="text-[10px] text-content-muted flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-surface-emphasis border border-divider rounded text-[9px]">Esc</kbd>
              close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
