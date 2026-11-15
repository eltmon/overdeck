/**
 * WorkspacesSection — the selected project's workspaces in the left column
 * (PAN-5293 F-D9, moved from Sidebar.tsx's Workspaces rail). Rail rows of
 * this project only (favorites first, then most recent), an Archived (N)
 * expander, and `+` for a new workspace. Rows keep the Sidebar's kind icon,
 * label rule, pipeline-phase badge, memory phase and PR badge. The section
 * renders nothing when the project has no workspace rows.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, GitBranch, Home, Plus, type LucideIcon } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { getPipelineIssuePhase, type PipelineIssuePhase } from '../../lib/pipeline-state';
import { issueByIdentifier } from '../../lib/selectors/issueIndex';
import { PullRequestBadge } from '../primitives/PullRequestBadge';
import { issuePullRequestBadgeLink } from '../primitives/issuePullRequest';
import { fetchRegisteredProjects, findRegisteredProject } from '../CommandDeck/UnknownProjectState';
import { isRailWorkspace, sortWorkspaces, type WorkspaceRegistryRow } from './workspaceRows';

const WORKSPACE_KIND_ICONS: Record<WorkspaceRegistryRow['kind'], LucideIcon> = {
  main: Home,
  issue: GitBranch,
  scratch: FileText,
};

type RowPhase = Exclude<PipelineIssuePhase, 'ready'>;

const PHASE_LABELS: Record<RowPhase, string> = {
  ship: 'Ship', review: 'Review', work: 'Work', plan: 'Plan', todo: 'Todo',
};

const PHASE_DOT_CLASSES: Record<RowPhase, string> = {
  ship: 'bg-success', review: 'bg-warning', work: 'bg-info',
  plan: 'bg-signal-review', todo: 'bg-muted-foreground/30',
};

async function fetchWorkspaceRegistry(): Promise<WorkspaceRegistryRow[]> {
  const res = await fetch('/api/workspace-registry');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.workspaces) ? data.workspaces : [];
}

function WorkspaceRow({ ws, projectName, onSelect }: { ws: WorkspaceRegistryRow; projectName: string; onSelect: (id: string) => void }) {
  const Icon = WORKSPACE_KIND_ICONS[ws.kind];
  const issueId = ws.kind === 'issue' ? ws.issueId : null;
  // PAN-1990 ac2: issue rows badge their pipeline phase ('ready' reads as work).
  const phase = useDashboardStore((state): RowPhase | undefined => {
    if (!issueId) return undefined;
    const issue = issueByIdentifier(state.issuesRaw, issueId);
    if (!issue) return undefined;
    const derived = state.derivedIssueStateByIssueId[issue.identifier] ?? state.derivedIssueStateByIssueId[issue.identifier.toUpperCase()];
    const raw = getPipelineIssuePhase(derived, issue);
    return raw === 'ready' ? 'work' : raw;
  });
  const pr = useDashboardStore((state) => (issueId ? state.derivedIssueStateByIssueId[issueId.toUpperCase()]?.pr : undefined));
  const prLink = issueId ? issuePullRequestBadgeLink(pr) : null;
  // PAN-3286 FR-12: main/scratch rows show their memory-synthesized phase.
  const memoryPhase = ws.kind !== 'issue' ? ws.memoryPhase ?? null : null;
  // Every project's primary checkout is named "main"; name the project instead.
  const label = ws.kind === 'main' && ws.name === 'main' ? ws.projectName ?? projectName : ws.name;

  return (
    <button
      type="button"
      onClick={() => onSelect(ws.id)}
      title={ws.title ?? ws.name}
      data-testid={`sidebar-workspace-${ws.id}`}
      className="list-row flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm font-medium text-body-foreground"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {(phase || prLink) && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {prLink && <span data-testid={`sidebar-workspace-pr-${ws.id}`}><PullRequestBadge link={prLink} /></span>}
          {phase && <span className={`h-2 w-2 shrink-0 rounded-full ${PHASE_DOT_CLASSES[phase]}`} aria-hidden="true" />}
          {phase && <span className="text-[10px] text-muted-foreground">{PHASE_LABELS[phase]}</span>}
        </span>
      )}
      {memoryPhase && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" data-testid={`sidebar-workspace-memory-phase-${ws.id}`}>
          {memoryPhase}
        </span>
      )}
    </button>
  );
}

export interface WorkspacesSectionProps {
  selectedProject: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onNewWorkspace: (projectKey?: string) => void;
}

export function WorkspacesSection({ selectedProject, onSelectWorkspace, onNewWorkspace }: WorkspacesSectionProps) {
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const { data: registeredProjects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60000,
  });
  const { data: workspacesRaw } = useQuery({
    queryKey: ['workspace-registry'],
    queryFn: fetchWorkspaceRegistry,
    refetchInterval: 10000,
  });
  const project = findRegisteredProject(registeredProjects, selectedProject);
  const projectKey = project?.key;

  const { active, archived } = useMemo(() => {
    const rows = (Array.isArray(workspacesRaw) ? workspacesRaw : []).filter((w) => projectKey !== undefined && w.projectId === projectKey);
    return {
      // The rail lists rows the operator created or favorited (PAN-5233); main checkouts only when favorited.
      active: sortWorkspaces(rows.filter((w) => !w.isArchived)).filter(isRailWorkspace),
      archived: sortWorkspaces(rows.filter((w) => w.isArchived)),
    };
  }, [workspacesRaw, projectKey]);

  if (!projectKey || (active.length === 0 && archived.length === 0)) return null;
  const projectName = project?.name ?? projectKey;

  return (
    <section aria-label="Workspaces" data-testid="sidebar-workspaces">
      <div className="flex items-center gap-2 px-2 pt-2 pb-1">
        <h2 className="eyebrow flex-1">Workspaces</h2>
        <button
          type="button"
          data-testid="sidebar-new-workspace"
          onClick={() => onNewWorkspace(projectKey)}
          title="New workspace"
          aria-label="New workspace"
          className="list-row rounded-md p-0.5 text-muted-foreground"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      {active.map((ws) => <WorkspaceRow key={ws.id} ws={ws} projectName={projectName} onSelect={onSelectWorkspace} />)}
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            data-testid="sidebar-workspaces-archived-toggle"
            onClick={() => setArchivedExpanded((prev) => !prev)}
            aria-expanded={archivedExpanded}
            className="list-row flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
          >
            {archivedExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <span>Archived</span>
            <span className="ml-auto text-[11px] text-muted-foreground">{archived.length}</span>
          </button>
          {archivedExpanded && archived.map((ws) => <WorkspaceRow key={ws.id} ws={ws} projectName={projectName} onSelect={onSelectWorkspace} />)}
        </div>
      )}
    </section>
  );
}
