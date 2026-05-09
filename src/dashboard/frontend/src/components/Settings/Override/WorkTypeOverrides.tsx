import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ModelRouteId, ModelId } from '../types';
import { WorkTypeTable } from './WorkTypeTable';

export interface WorkTypeOverridesProps {
  overrides: Partial<Record<ModelRouteId, ModelId>>;
  presetModels: Partial<Record<ModelRouteId, ModelId>>;
  onConfigureOverride: (workType: ModelRouteId) => void;
  onRemoveOverride: (workType: ModelRouteId) => void;
}

export function WorkTypeOverrides({ overrides, presetModels, onConfigureOverride, onRemoveOverride }: WorkTypeOverridesProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-card rounded-lg p-5 border border-border flex items-center justify-between hover:bg-popover transition-colors shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-muted-foreground">tune</span>
          <div className="text-left">
            <span className="text-lg font-bold">Advanced: Work Type Overrides</span>
            <p className="text-xs text-muted-foreground">Define granular model mapping based on specific payload types</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="text-muted-foreground w-6 h-6" /> : <ChevronDown className="text-muted-foreground w-6 h-6" />}
      </button>

      {/* Expanded Content */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          expanded ? 'max-h-[2000px] mt-4 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="bg-card rounded-lg border border-border">
          <WorkTypeTable
            overrides={overrides}
            presetModels={presetModels}
            onConfigureOverride={onConfigureOverride}
            onRemoveOverride={onRemoveOverride}
          />
        </div>
      </div>
    </section>
  );
}
