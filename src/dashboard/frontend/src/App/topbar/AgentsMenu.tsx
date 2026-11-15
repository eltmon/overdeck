// The top bar's agents menu (PAN-5292 WI-E1, FR-E2, E-D17, E-D18).
//
// "N agents working ▾" opens a list of every working session from
// useAgentsWorking() — the one count every surface shares (PAN-5287 D-9) — plus
// "Open the Agents page" and "Stop all agents…". It replaces the green
// RunningAgentsPill and the bar's red Stop-all button: running is blue, and the
// stop lives one click deeper so it is never pressed by accident.
//
// This is aggregate chrome (docs/DASHBOARD-ARCHITECTURE.md "Render discipline
// (PAN-4560)"): it subscribes to whole slices because it shows a cross-issue
// total, so it must stay a leaf and never move into AppChrome or App.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

import { selectIssues, useDashboardStore } from '../../lib/store';
import { useAgentsWorking, type WorkingRole, type WorkingRow } from '../../lib/selectors/agentsWorking';
import { formatIssueRef } from '../../lib/issueLabel';
import { navigateToDecisionSubject } from '../../lib/navigateToDecision';
import { navigateToIssue, relativeTime } from '../../components/AgentPillPopoverRow';
import { fetchConversations, type Conversation } from '../../components/CommandDeck/ConversationList';
import { fetchRegisteredProjects } from '../../components/CommandDeck/UnknownProjectState';
import { triggerEmergencyStop } from '../../components/EmergencyStopOverlay';
import { MenuItemButton, MenuSeparator, MenuSurface } from '../../components/shared/ContextMenu';
import type { Agent, Issue } from '../../types';

const ROLE_WORDS: Record<WorkingRole, string> = {
  planning: 'planning',
  building: 'building',
  review: 'review',
  test: 'test',
  conversation: 'conversation',
  other: 'agent',
};

/** "No agents working" / "1 agent working" / "N agents working" (E-D18). */
export function agentsWorkingLabel(count: number): string {
  if (count === 0) return 'No agents working';
  return `${count} agent${count === 1 ? '' : 's'} working`;
}

interface MenuRow {
  row: WorkingRow;
  title: string;
  subLine: string;
  activityAt: string | undefined;
}

function navigateToAgentsPage(): void {
  if (window.location.pathname !== '/agents') window.history.pushState({}, '', '/agents');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function openRow(row: WorkingRow): void {
  if (row.kind === 'conversation') {
    navigateToDecisionSubject({ id: row.id, source: 'conversation' });
    return;
  }
  if (row.issueId && row.role !== 'other') {
    navigateToIssue(row.issueId);
    return;
  }
  navigateToAgentsPage();
}

function timestamp(iso: string | undefined): number {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AgentsMenu() {
  const working = useAgentsWorking();
  const agentsById = useDashboardStore((s) => s.agentsById) as unknown as Record<string, Agent | undefined>;
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];
  // Same key and interval as useAgentsWorking, so the fetch is shared.
  const { data: conversations } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });
  const { data: projects } = useQuery({ queryKey: ['registered-projects'], queryFn: fetchRegisteredProjects });
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const menuRows = useMemo<MenuRow[]>(() => {
    const projectName = new Map((Array.isArray(projects) ? projects : []).map((p) => [p.key, p.name || p.key]));
    const conversationByName = new Map(
      (Array.isArray(conversations) ? conversations : []).map((c: Conversation) => [c.name, c]),
    );
    // Store issue rows arrive untyped from the snapshot; skip any without a string identifier.
    const issueTitle = new Map<string, string>();
    for (const issue of issues) {
      if (typeof issue?.identifier === 'string') issueTitle.set(issue.identifier.toUpperCase(), issue.title);
    }

    return working.rows
      .map((row): MenuRow => {
        let title: string;
        let model: string | null | undefined;
        let activityAt: string | undefined;
        if (row.kind === 'conversation') {
          const conv = conversationByName.get(row.id);
          title = row.label;
          model = conv?.model;
          activityAt = conv?.lastActivityAt ?? conv?.createdAt;
        } else {
          const agent = agentsById[row.id];
          title = formatIssueRef(row.issueId, row.issueId ? issueTitle.get(row.issueId.toUpperCase()) : undefined) ?? row.id;
          model = agent?.model;
          activityAt = agent?.lastActivity ?? agent?.startedAt;
        }
        const project = row.projectKey ? projectName.get(row.projectKey) ?? row.projectKey : undefined;
        const subLine = [project, ROLE_WORDS[row.role], model || undefined].filter(Boolean).join(' · ');
        return { row, title, subLine, activityAt };
      })
      .sort((a, b) => timestamp(b.activityAt) - timestamp(a.activityAt));
  }, [working.rows, agentsById, issues, conversations, projects]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const count = working.count;
  const now = Date.now();

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="agents-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 items-center gap-[7px] whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-[12.5px] text-foreground transition-colors hover:bg-accent"
      >
        <span
          data-testid="agents-menu-dot"
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${count > 0 ? 'bg-state-live' : 'bg-state-waiting'}`}
        />
        {agentsWorkingLabel(count)}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <MenuSurface
          aria-label="Agents working"
          data-testid="agents-menu"
          onClose={() => setOpen(false)}
          returnFocusRef={triggerRef}
          className="absolute right-0 top-full z-50 mt-1.5 w-[340px]"
        >
          <div className="eyebrow px-2 pb-1 pt-1.5">Working now</div>
          {menuRows.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">Nothing is running.</div>
          ) : (
            menuRows.map(({ row, title, subLine, activityAt }) => (
              <MenuItemButton
                key={row.key}
                data-testid="agents-menu-row"
                onClick={() => {
                  setOpen(false);
                  openRow(row);
                }}
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-state-live" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{title}</span>
                  {subLine && <span className="block truncate text-[11.5px] text-muted-foreground">{subLine}</span>}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {activityAt ? relativeTime(activityAt, now) : ''}
                </span>
              </MenuItemButton>
            ))
          )}
          <MenuSeparator />
          <MenuItemButton
            onClick={() => {
              setOpen(false);
              navigateToAgentsPage();
            }}
          >
            Open the Agents page
          </MenuItemButton>
          <MenuItemButton
            destructive
            disabled={count === 0}
            title={count === 0 ? 'No agents are working' : undefined}
            onClick={() => {
              setOpen(false);
              triggerEmergencyStop();
            }}
          >
            Stop all agents…
          </MenuItemButton>
        </MenuSurface>
      )}
    </div>
  );
}
