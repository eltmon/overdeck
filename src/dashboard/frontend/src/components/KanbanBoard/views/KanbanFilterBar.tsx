import { ChevronDown, ChevronRight, Filter, RotateCcw } from 'lucide-react';
import type { LinearProject } from '../../../types';
import type { CycleFilter } from '../types';

interface KanbanFilterBarProps {
  cycleFilter: CycleFilter;
  onCycleFilterChange: (cycle: CycleFilter) => void;
  includeCompleted: boolean;
  onIncludeCompletedChange: (includeCompleted: boolean) => void;
  onRefreshTrackers: () => Promise<void>;
  issueCount: number;
  hasAnyRallyHierarchy: boolean;
  allExpanded: boolean;
  onExpandAllFeatures: () => void;
  onCollapseAllFeatures: () => void;
  projects: LinearProject[];
  selectedProjects: Set<string>;
  onToggleProject: (projectId: string) => void;
  onClearProjects: () => void;
}

export function KanbanFilterBar({
  cycleFilter,
  onCycleFilterChange,
  includeCompleted,
  onIncludeCompletedChange,
  onRefreshTrackers,
  issueCount,
  hasAnyRallyHierarchy,
  allExpanded,
  onExpandAllFeatures,
  onCollapseAllFeatures,
  projects,
  selectedProjects,
  onToggleProject,
  onClearProjects,
}: KanbanFilterBarProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: Cycle + controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Cycle:</span>
          <div className="flex rounded-lg overflow-hidden border border-border">
            {(['current', 'all', 'backlog', 'canceled'] as CycleFilter[]).map((cycle) => (
              <button
                key={cycle}
                onClick={() => onCycleFilterChange(cycle)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  cycleFilter === cycle
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground/70 hover:text-foreground hover:bg-accent'
                }`}
              >
                {cycle === 'current' ? 'Current' : cycle === 'all' ? 'All' : cycle === 'backlog' ? 'Backlog' : 'Canceled'}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => onIncludeCompletedChange(e.target.checked)}
            className="w-4 h-4 rounded border-border bg-background text-primary focus:ring-ring focus:ring-offset-surface"
          />
          <span className="text-sm font-medium text-muted-foreground">Include closed-out</span>
        </label>

        <button
          onClick={onRefreshTrackers}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-background border border-border hover:bg-accent rounded-lg transition-colors"
          title="Force refresh all trackers"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <span className="text-sm text-muted-foreground">
          {issueCount} issues
        </span>

        {/* Expand/Collapse all Rally features — only visible when Rally hierarchy exists */}
        {hasAnyRallyHierarchy && cycleFilter === 'current' && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={allExpanded ? onCollapseAllFeatures : onExpandAllFeatures}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground bg-background border border-border hover:bg-accent rounded-lg transition-colors"
              title={allExpanded ? 'Collapse all features' : 'Expand all features'}
            >
              {allExpanded ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
              <span>{allExpanded ? 'Collapse' : 'Expand'} all</span>
            </button>
          </div>
        )}
      </div>

      {/* Row 2: Project filter */}
      {projects.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground">Projects:</span>
          {projects.map((project) => {
            const isExplicitlySelected = selectedProjects.has(project.id);
            return (
              <button
                key={project.id}
                onClick={() => onToggleProject(project.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  isExplicitlySelected
                    ? 'bg-accent text-foreground border-foreground/20'
                    : selectedProjects.size === 0
                      ? 'bg-card text-foreground/70 border-foreground/15 hover:bg-accent hover:text-foreground hover:border-foreground/25'
                      : 'bg-card text-muted-foreground border-foreground/10 hover:border-foreground/20 hover:text-foreground opacity-50'
                }`}
                title={isExplicitlySelected ? `Remove ${project.name} filter` : `Filter to ${project.name}`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: project.color || '#6b7280' }}
                />
                {project.name}
              </button>
            );
          })}
          {selectedProjects.size > 0 && (
            <button
              onClick={onClearProjects}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
