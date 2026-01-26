import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { WorkTypeId, ModelId } from '../types';
import { WorkTypeTable } from './WorkTypeTable';

export interface WorkTypeOverridesProps {
  overrides: Partial<Record<WorkTypeId, ModelId>>;
  presetModels: Partial<Record<WorkTypeId, ModelId>>;
  onConfigureOverride: (workType: WorkTypeId) => void;
  onRemoveOverride: (workType: WorkTypeId) => void;
}

export function WorkTypeOverrides({ overrides, presetModels, onConfigureOverride, onRemoveOverride }: WorkTypeOverridesProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-[#24283b] rounded-lg p-5 border border-slate-700/50 flex items-center justify-between hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-400">tune</span>
          <div className="text-left">
            <span className="text-lg font-bold">Advanced: Work Type Overrides</span>
            <p className="text-xs text-[#a390cb]">Define granular model mapping based on specific payload types</p>
          </div>
        </div>
        {expanded ? <ChevronUp className="text-slate-400 w-6 h-6" /> : <ChevronDown className="text-slate-400 w-6 h-6" />}
      </button>

      {/* Expanded Content */}
      {expanded && (
        <div className="mt-4 bg-[#24283b] rounded-lg border border-slate-700/50 overflow-hidden">
          <WorkTypeTable
            overrides={overrides}
            presetModels={presetModels}
            onConfigureOverride={onConfigureOverride}
            onRemoveOverride={onRemoveOverride}
          />
        </div>
      )}
    </section>
  );
}
