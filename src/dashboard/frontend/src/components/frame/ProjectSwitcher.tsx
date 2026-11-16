/**
 * ProjectSwitcher — the left column's project picker (PAN-5293 F-D7, F-D8).
 * Replaces the Sidebar's Projects tree.
 *
 * The button shows the selected project's mark (two-letter initials), name
 * and path. Its menu lists every registered project in owner groups (as the
 * Sidebar did), each with its machine count and a status word, then
 * No project, projects on other machines, Add a project and New workspace.
 * PAN-5343 H-D2: the first menu item selects the All projects deck.
 * A filter input appears when there are more than 8 projects.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, FolderPlus, Plus } from 'lucide-react';
import type { DashboardState } from '../../lib/store';
import { useDashboardStore } from '../../lib/store';
import { getPipelineIssuePhase } from '../../lib/pipeline-state';
import { useAgentsWorking } from '../../lib/selectors/agentsWorking';
import { issueByIdentifier } from '../../lib/selectors/issueIndex';
import { ALL_PROJECTS_KEY, ALL_PROJECTS_LABEL, fetchProjects, NO_PROJECT_KEY, NO_PROJECT_LABEL, type ProjectData } from '../CommandDeck/projectsData';
import { fetchConversations, type Conversation } from '../CommandDeck/ConversationList';
import { MenuOverlay, MenuSeparator, PopoverSurface } from '../shared/ContextMenu';
import { OwnerGroupHeader } from '../sidebar/OwnerGroupHeader';
import { OtherMachineProjects, ProjectMachineCount } from '../sidebar/OtherMachineProjects';
import { groupProjectsByOwner, OTHER_OWNER_KEY, useCollapsedOwners } from '../sidebar/projectOwners';
import { ProjectMark } from './ProjectMark';

export { projectInitials } from './ProjectMark';

/** Above this many projects the menu shows a filter input. */
export const PROJECT_FILTER_THRESHOLD = 8;

export interface ProjectSwitcherProps {
  selectedProject: string | null;
  onSelectProject: (name: string) => void;
  onNewProject: () => void;
  onNewWorkspace: (projectKey?: string) => void;
  /** The collapsed column shows only the mark. */
  collapsed: boolean;
}

/** A path with the home directory (/home/<user>, /Users/<user>) shortened to ~. */
export function tildeHomePath(path: string): string {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
}

/** How many of the project's issues are in the In review phase. */
export function countInReview(state: Pick<DashboardState, 'issuesRaw' | 'derivedIssueStateByIssueId'>, project: ProjectData): number {
  let count = 0;
  for (const feature of project.features) {
    const derived = state.derivedIssueStateByIssueId[feature.issueId]
      ?? state.derivedIssueStateByIssueId[feature.issueId.toUpperCase()];
    if (getPipelineIssuePhase(derived, issueByIdentifier(state.issuesRaw, feature.issueId)) === 'review') count += 1;
  }
  return count;
}

/** PAN-5343 H-D2: the All projects subtitle, "<N> projects · <M> active". */
export function allProjectsSubtitle(projectCount: number, activeCount: number): string {
  return `${projectCount} ${projectCount === 1 ? 'project' : 'projects'} · ${activeCount} active`;
}

/** Conversations with a live session, read from the shared ['conversations'] cache (no polling of its own). */
function useActiveConversationCount(): number {
  const { data } = useQuery({ queryKey: ['conversations'], queryFn: fetchConversations, staleTime: Infinity });
  return useMemo(() => (data ?? []).filter((c: Conversation) => c.sessionAlive === true).length, [data]);
}

/** F-D8: "<n> working", else "<n> in review", else "idle". Its own component so only this row re-renders. */
function ProjectStatusWord({ project }: { project: ProjectData }) {
  const working = useAgentsWorking({ projectKey: project.key }).count;
  const inReview = useDashboardStore((state) => countInReview(state, project));
  const word = working > 0 ? `${working} working` : inReview > 0 ? `${inReview} in review` : 'idle';
  return (
    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" data-testid={`project-status-${project.name}`}>
      {word}
    </span>
  );
}

export function ProjectSwitcher({ selectedProject, onSelectProject, onNewProject, onNewWorkspace, collapsed }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { data: projects = [] } = useQuery({
    queryKey: ['command-deck-projects'],
    queryFn: fetchProjects,
    refetchInterval: 30000,
  });
  const ownerGroups = useMemo(() => groupProjectsByOwner(projects), [projects]);
  const [collapsedOwners, toggleOwner] = useCollapsedOwners();

  const activeCount = useActiveConversationCount();
  const allSubtitle = allProjectsSubtitle(projects.length, activeCount);

  const isNoProject = selectedProject === NO_PROJECT_KEY;
  const isAllProjects = selectedProject === ALL_PROJECTS_KEY;
  const selected = selectedProject && !isNoProject && !isAllProjects ? projects.find((p) => p.name === selectedProject) : undefined;
  const label = isNoProject ? NO_PROJECT_LABEL : isAllProjects ? ALL_PROJECTS_LABEL : selected?.name ?? selectedProject ?? 'Choose a project';
  const showFilter = projects.length > PROJECT_FILTER_THRESHOLD;
  const needle = filter.trim().toLowerCase();

  const close = () => {
    setOpen(false);
    setFilter('');
  };
  const pick = (name: string) => {
    onSelectProject(name);
    close();
  };

  const renderRow = (project: ProjectData) => (
    <button
      key={project.path}
      type="button"
      role="menuitem"
      onClick={() => pick(project.name)}
      title={tildeHomePath(project.path)}
      data-testid={`project-switcher-row-${project.name}`}
      aria-current={project.name === selectedProject ? 'true' : undefined}
      className={`list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium ${project.name === selectedProject ? 'text-foreground' : 'text-body-foreground'}`}
    >
      <ProjectMark size="sm" name={project.name} projectKey={project.key} />
      <span className="truncate">{project.name}</span>
      <ProjectMachineCount projectKey={project.key} />
      <ProjectStatusWord project={project} />
    </button>
  );

  const projectRows = needle
    ? projects.filter((p) => p.name.toLowerCase().includes(needle)).map(renderRow)
    : ownerGroups.flatMap((group) => {
      const grouped = ownerGroups.length > 1;
      const groupCollapsed = grouped && collapsedOwners.includes(group.owner ?? OTHER_OWNER_KEY);
      const header = grouped && (
        <OwnerGroupHeader
          key={`owner-${group.owner ?? ''}`}
          owner={group.owner}
          collapsed={groupCollapsed}
          onToggle={toggleOwner}
          holdsActive={group.projects.some((p) => p.name === selectedProject)}
        />
      );
      return [header, ...(groupCollapsed ? [] : group.projects).map(renderRow)];
    });

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="project-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={`list-row flex w-full items-center gap-2 rounded-md text-left ${collapsed ? 'justify-center p-1' : 'px-2 py-1.5'}`}
      >
        {selected
          ? <ProjectMark name={selected.name} projectKey={selected.key} />
          : <ProjectMark name={label} muted glyph={isAllProjects ? '✱' : undefined} />}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span data-testid="project-switcher-name" className="block truncate font-display text-sm font-medium text-foreground">{label}</span>
              {selected && (
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{tildeHomePath(selected.path)}</span>
              )}
              {isAllProjects && (
                <span data-testid="project-switcher-subtitle" className="block truncate text-[11px] text-muted-foreground">{allSubtitle}</span>
              )}
            </span>
            <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
      {open && (
        <>
          <MenuOverlay onClick={close} />
          <PopoverSurface
            aria-label="Switch project"
            data-testid="project-switcher-menu"
            onClose={close}
            returnFocusRef={triggerRef}
            className={`absolute top-full z-[1000] mt-1 w-[280px] max-h-[70vh] overflow-y-auto ${collapsed ? 'left-full ml-1 top-0 mt-0' : 'left-0'}`}
          >
            {showFilter && (
              <input
                type="text"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter projects"
                aria-label="Filter projects"
                data-testid="project-switcher-filter"
                className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(ALL_PROJECTS_KEY)}
              data-testid="project-switcher-row-all-projects"
              aria-current={isAllProjects ? 'true' : undefined}
              className={`list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium ${isAllProjects ? 'text-foreground' : 'text-body-foreground'}`}
            >
              <ProjectMark size="sm" name={ALL_PROJECTS_LABEL} muted glyph="✱" />
              <span className="truncate">{ALL_PROJECTS_LABEL}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{allSubtitle}</span>
            </button>
            <MenuSeparator />
            {projects.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects</p>
            ) : projectRows}
            <MenuSeparator />
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(NO_PROJECT_KEY)}
              data-testid="project-switcher-row-no-project"
              aria-current={isNoProject ? 'true' : undefined}
              className="list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium italic text-body-foreground"
            >
              <ProjectMark size="sm" name={NO_PROJECT_LABEL} muted />
              {NO_PROJECT_LABEL}
            </button>
            <OtherMachineProjects />
            <MenuSeparator />
            <button
              type="button"
              role="menuitem"
              onClick={() => { close(); onNewProject(); }}
              data-testid="project-switcher-add-project"
              className="list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-body-foreground"
            >
              <Plus aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              Add a project
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => { close(); onNewWorkspace(selected?.key); }}
              data-testid="project-switcher-new-workspace"
              className="list-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-body-foreground"
            >
              <FolderPlus aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              {selected ? `New workspace in ${selected.name}…` : 'New workspace…'}
            </button>
          </PopoverSurface>
        </>
      )}
    </div>
  );
}
