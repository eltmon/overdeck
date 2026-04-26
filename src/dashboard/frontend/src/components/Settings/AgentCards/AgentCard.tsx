import { useState } from 'react';
import { ChevronDown, ChevronRight, Settings2, Zap } from 'lucide-react';
import { WorkTypeId, ModelId } from '../types';

export interface AgentPhase {
  id: WorkTypeId;
  name: string;
  model: ModelId;
  isOverride: boolean;
}

export interface AgentCardProps {
  name: string;
  icon: string;
  description: string;
  primaryModel: ModelId;
  isOverride: boolean;
  phases?: AgentPhase[];
  variant?: 'default' | 'compact';
  onConfigureOverride?: (workType: WorkTypeId) => void;
  onRemoveOverride?: (workType: WorkTypeId) => void;
}

const MODEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'kimi': { bg: 'badge-bg-success', text: 'text-success-foreground', border: 'badge-border-success' },
  'claude': { bg: 'badge-bg-warning', text: 'text-warning-foreground', border: 'badge-border-warning' },
  'gpt': { bg: 'badge-bg-primary', text: 'text-primary', border: 'badge-border-primary' },
  'gemini': { bg: 'badge-bg-signal-review', text: 'text-signal-review-foreground', border: 'badge-border-signal-review' },
};

function getModelStyle(model: ModelId) {
  const provider = model.toLowerCase();
  if (provider.includes('kimi') || provider.includes('k2')) return MODEL_COLORS['kimi'];
  if (provider.includes('claude') || provider.includes('sonnet') || provider.includes('opus')) return MODEL_COLORS['claude'];
  if (provider.includes('gpt') || provider.includes('o1') || provider.includes('o3')) return MODEL_COLORS['gpt'];
  if (provider.includes('gemini')) return MODEL_COLORS['gemini'];
  return { bg: 'bg-card', text: 'text-foreground', border: 'border-border' };
}

function ModelBadge({ model, isOverride, size = 'md' }: { model: ModelId; isOverride: boolean; size?: 'sm' | 'md' }) {
  const style = getModelStyle(model);
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <div className={`inline-flex items-center gap-1.5 ${sizeClasses} rounded-full ${style.bg} ${style.text} border ${style.border}`}>
      {isOverride && <Settings2 className="w-3 h-3" />}
      <span className="font-medium">{model}</span>
    </div>
  );
}

export function AgentCard({
  name,
  icon,
  description,
  primaryModel,
  isOverride,
  phases,
  variant = 'default',
  onConfigureOverride,
  onRemoveOverride,
}: AgentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasPhases = phases && phases.length > 0;

  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-between p-3 bg-card rounded-lg border border-border hover:border-border transition-colors shadow-sm">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-xl text-[#a078f7]">{icon}</span>
          <div>
            <div className="font-medium text-foreground">{name}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        <ModelBadge model={primaryModel} isOverride={isOverride} size="sm" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden hover:border-border transition-colors shadow-sm">
      {/* Card Header */}
      <div
        className={`p-4 ${hasPhases ? 'cursor-pointer' : ''}`}
        onClick={() => hasPhases && setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl text-[#a078f7]">{icon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{name}</h3>
                {hasPhases && (
                  <span className="text-xs text-muted-foreground bg-card px-2 py-0.5 rounded-full">
                    {phases.length} phases
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ModelBadge model={primaryModel} isOverride={isOverride} />
            {hasPhases && (
              <button className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Phases */}
      {hasPhases && isExpanded && (
        <div className="border-t border-border bg-card">
          <div className="p-3 space-y-2">
            {phases.map((phase) => (
              <div
                key={phase.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-card transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{phase.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ModelBadge model={phase.model} isOverride={phase.isOverride} size="sm" />
                  {onRemoveOverride && phase.isOverride && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveOverride(phase.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                      title="Remove override"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  )}
                  {onConfigureOverride && !phase.isOverride && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfigureOverride(phase.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-[#a078f7] transition-all"
                      title="Configure override"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
