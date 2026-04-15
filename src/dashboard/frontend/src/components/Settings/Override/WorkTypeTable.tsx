import { WorkTypeId, WorkTypeCategory, WORK_TYPE_CATEGORIES, ModelId } from '../types';
import { Badge } from '../Shared/Badge';
import { Settings, X } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface WorkTypeTableProps {
  overrides: Partial<Record<WorkTypeId, ModelId>>;
  presetModels: Partial<Record<WorkTypeId, ModelId>>;
  onConfigureOverride: (workType: WorkTypeId) => void;
  onRemoveOverride: (workType: WorkTypeId) => void;
}

export function WorkTypeTable({ overrides, presetModels, onConfigureOverride, onRemoveOverride }: WorkTypeTableProps) {
  const categories: WorkTypeCategory[] = ['issue-agent', 'specialist', 'review', 'subagent', 'cli'];

  const categoryLabels: Record<WorkTypeCategory, string> = {
    'issue-agent': 'Issue Agent Phases',
    'specialist': 'Specialist Agents',
    'review': 'Review Agents',
    'subagent': 'Subagents',
    'cli': 'CLI Contexts',
    'pre-work': 'Pre-Work',
    'workflow': 'Workflow',
  };

  const getEffectiveModel = (workType: WorkTypeId): ModelId => {
    return overrides[workType] || presetModels[workType] || 'claude-sonnet-4-5';
  };

  const hasOverride = (workType: WorkTypeId): boolean => {
    return workType in overrides;
  };

  return (
    <div className="space-y-1 overflow-x-auto">
      {/* Table Header - using fr units instead of % to properly account for gaps */}
      <div className="grid grid-cols-[2fr_minmax(200px,1.5fr)_120px] gap-4 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-content-subtle border-b border-divider min-w-[600px]">
        <div>Work Type</div>
        <div>Current Model</div>
        <div>Override</div>
      </div>

      {/* Table Body */}
      {categories.map((category) => (
        <div key={category} className="min-w-[600px]">
          {/* Category Header */}
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-content-muted bg-surface-overlay">
            {categoryLabels[category]}
          </div>

          {/* Work Type Rows */}
          {WORK_TYPE_CATEGORIES[category].map((workType, idx) => {
            const isOverridden = hasOverride(workType.id);
            const model = getEffectiveModel(workType.id);

            return (
              <div
                key={workType.id}
                className={cn(
                  'grid grid-cols-[2fr_minmax(200px,1.5fr)_120px] gap-4 px-4 py-3 text-sm hover:bg-surface-overlay transition-colors',
                  idx % 2 === 0 ? 'bg-surface-raised' : 'bg-transparent'
                )}
              >
                {/* Work Type Name */}
                <div className="text-content font-medium truncate">{workType.displayName}</div>

                {/* Current Model with Badge */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-content-subtle truncate flex-1">{model}</span>
                  <Badge variant={isOverridden ? 'override' : 'preset'} className="flex-shrink-0">{isOverridden ? 'override' : 'preset'}</Badge>
                </div>

                {/* Override Actions */}
                <div className="flex items-center gap-2">
                  {isOverridden ? (
                    <button
                      onClick={() => onRemoveOverride(workType.id)}
                      className="text-destructive hover:text-destructive/80 transition-colors"
                      title="Remove override"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={() => onConfigureOverride(workType.id)}
                      className="text-content-muted hover:text-content transition-colors"
                      title="Configure override"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Table Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-divider text-sm min-w-[600px]">
        <button className="text-content-muted hover:text-content transition-colors">Reset all overrides to preset</button>
        <span className="text-content-muted">
          {Object.keys(overrides).length} override{Object.keys(overrides).length !== 1 ? 's' : ''} active
        </span>
      </div>
    </div>
  );
}
