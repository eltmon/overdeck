/**
 * The merge train (PAN-4753 WI-10, R10): one component, two placements.
 *
 * - `all-projects` (Flywheel rail, Awaiting Merge): project filter chips
 *   (persisted under `merge-train.projectFilter`), one `ProjectTrainCard`
 *   per shown project with something on its train, and a footer naming the
 *   enabled projects with nothing to merge.
 * - `project` (project home): that project's card only, wrapped in
 *   `id="merge-train"` so the project settings link can scroll to it.
 *
 * Data: `GET /api/merge-train/board` (WI-7). Merge runs are polled every 3 s
 * only while something is merging, so the step tracker advances between
 * board polls.
 */
import { useEffect, useState } from 'react';
import type { BoardProject } from './boardTypes';
import { ProjectTrainCard } from './ProjectTrainCard';
import {
  ALL_FILTERED_LINE,
  ALL_PROJECTS_CHIP,
  FILTER_LABEL,
  LOADING_LINE,
  LOAD_FAILED_LINE,
  NOTHING_TO_MERGE_LINE,
  NO_PROJECTS_LINE,
  idleFooter,
} from './trainCopy';
import { boardHasMerging, useMergeRuns, useMergeTrainBoard } from './useMergeTrainBoard';

/** localStorage key holding the operator's project-filter selection (shared with the old view). */
export const MERGE_TRAIN_PROJECT_FILTER_KEY = 'merge-train.projectFilter';

export interface MergeTrainProps {
  placement: 'all-projects' | 'project';
  projectKey?: string;
  /** Poll while on screen (default true). */
  active?: boolean;
  onNavigateIssue?: (issueId: string) => void;
}

function readStoredFilter(): string[] | null {
  try {
    const raw = window.localStorage.getItem(MERGE_TRAIN_PROJECT_FILTER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

function writeStoredFilter(keys: string[] | null): void {
  try {
    if (keys === null) window.localStorage.removeItem(MERGE_TRAIN_PROJECT_FILTER_KEY);
    else window.localStorage.setItem(MERGE_TRAIN_PROJECT_FILTER_KEY, JSON.stringify(keys));
  } catch {
    // A blocked localStorage costs the operator persistence, not the view.
  }
}

/**
 * An enabled project with no cars, no strikes and no batch in play
 * (assembling, ready or superseded). Disabled and errored projects are never
 * idle: "train off" and a failed read are both worth a card.
 */
export function isIdleProject(project: BoardProject): boolean {
  if (!project.enabled || project.error) return false;
  return project.cars.length === 0
    && project.strikes.length === 0
    && !project.batches.some((b) => b.status === 'assembling' || b.status === 'ready' || b.status === 'superseded');
}

const CHIP = 'rounded-md border px-2 py-0.5 text-[11px]';

export function MergeTrain({ placement, projectKey, active = true, onNavigateIssue }: MergeTrainProps) {
  const scoped = placement === 'project' ? projectKey : undefined;
  const { data: board, isLoading, isError } = useMergeTrainBoard({ projectKey: scoped, active });
  const runs = useMergeRuns(active && boardHasMerging(board));
  const [selected, setSelected] = useState<string[] | null>(() => (placement === 'all-projects' ? readStoredFilter() : null));
  const projects = board?.projects ?? [];
  const masterEnabled = board?.masterEnabled ?? true;

  // Drop filter entries for projects that no longer exist.
  useEffect(() => {
    if (placement !== 'all-projects' || selected === null || projects.length === 0) return;
    const known = new Set(projects.map((p) => p.projectKey));
    const pruned = selected.filter((k) => known.has(k));
    if (pruned.length === selected.length) return;
    const next = pruned.length === 0 ? null : pruned;
    setSelected(next);
    writeStoredFilter(next);
  }, [placement, projects, selected]);

  if (placement === 'project') {
    const project = projects.find((p) => p.projectKey === projectKey) ?? projects[0];
    return (
      <div id="merge-train" data-testid="merge-train" className="scroll-mt-4">
        {project
          ? <ProjectTrainCard project={project} masterEnabled={masterEnabled} runs={runs} onNavigateIssue={onNavigateIssue} />
          : <p className="text-[12px] text-muted-foreground">{isLoading ? LOADING_LINE : isError ? LOAD_FAILED_LINE : NO_PROJECTS_LINE}</p>}
      </div>
    );
  }

  const isSelected = (key: string) => selected === null || selected.includes(key);
  // With "All projects" active a chip narrows to that project; afterwards
  // chips add or remove projects, and none or every project means all again.
  const toggle = (key: string) => {
    const current = selected ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    const resolved = next.length === 0 || next.length === projects.length ? null : next;
    setSelected(resolved);
    writeStoredFilter(resolved);
  };
  const showAll = () => { setSelected(null); writeStoredFilter(null); };

  const shown = projects.filter((p) => isSelected(p.projectKey));
  const cards = shown.filter((p) => !isIdleProject(p));
  const idle = shown.filter(isIdleProject);

  return (
    <div data-testid="merge-train" className="space-y-3">
      {projects.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="merge-train-project-filter">
          <span className="text-[11px] text-muted-foreground">{FILTER_LABEL}</span>
          <button
            type="button"
            aria-pressed={selected === null}
            onClick={showAll}
            className={`${CHIP} ${selected === null ? 'border-muted-foreground bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
          >
            {ALL_PROJECTS_CHIP}
          </button>
          {projects.map((p) => {
            const on = selected !== null && selected.includes(p.projectKey);
            return (
              <button
                key={p.projectKey}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.projectKey)}
                className={`${CHIP} ${on ? 'border-muted-foreground bg-muted text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}
              >
                {p.projectName}
              </button>
            );
          })}
        </div>
      )}

      {projects.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{isLoading ? LOADING_LINE : isError ? LOAD_FAILED_LINE : NO_PROJECTS_LINE}</p>
      ) : shown.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{ALL_FILTERED_LINE}</p>
      ) : cards.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{NOTHING_TO_MERGE_LINE}</p>
      ) : (
        cards.map((project) => (
          <ProjectTrainCard
            key={project.projectKey}
            project={project}
            masterEnabled={masterEnabled}
            runs={runs}
            onNavigateIssue={onNavigateIssue}
          />
        ))
      )}

      {idle.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="merge-train-idle-footer">
          {idleFooter(idle.map((p) => p.projectName))}
        </p>
      )}
    </div>
  );
}
