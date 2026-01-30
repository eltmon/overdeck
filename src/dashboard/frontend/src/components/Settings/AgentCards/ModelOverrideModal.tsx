import { useState, useMemo } from 'react';
import { WorkTypeId, ModelId } from '../types';

// Model capabilities that can be matched to work types
type Capability = 'reasoning' | 'code' | 'vision' | 'fast' | 'cost-efficient' | 'large-context' | 'complex-math' | 'efficiency';

interface ModelDef {
  id: ModelId;
  name: string;
  icon: string;
  tier?: 'premium' | 'balanced' | 'fast';
  capabilities: Capability[];
}

interface ProviderDef {
  name: string;
  models: ModelDef[];
}

// Models grouped by provider
const MODELS_BY_PROVIDER: Record<string, ProviderDef> = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-5' as ModelId, name: 'Claude Opus 4.5', icon: 'diamond', tier: 'premium', capabilities: ['reasoning', 'code', 'vision'] },
      { id: 'claude-sonnet-4-5' as ModelId, name: 'Claude Sonnet 4.5', icon: 'auto_awesome', tier: 'balanced', capabilities: ['reasoning', 'code', 'vision'] },
      { id: 'claude-haiku-3-5' as ModelId, name: 'Claude Haiku', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'cost-efficient'] },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', icon: 'science', capabilities: ['reasoning', 'code', 'vision'] },
      { id: 'o1' as ModelId, name: 'o1', icon: 'psychology', tier: 'premium', capabilities: ['reasoning', 'complex-math'] },
      { id: 'o3-mini' as ModelId, name: 'o3-mini', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'reasoning'] },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-2.5-pro' as ModelId, name: 'Gemini 2.5 Pro', icon: 'model_training', tier: 'premium', capabilities: ['reasoning', 'large-context', 'code'] },
      { id: 'gemini-2.5-flash' as ModelId, name: 'Gemini 2.5 Flash', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'cost-efficient'] },
    ],
  },
  kimi: {
    name: 'Kimi',
    models: [
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', icon: 'token', capabilities: ['efficiency', 'code', 'reasoning'] },
    ],
  },
  zai: {
    name: 'Z.AI',
    models: [
      { id: 'glm-4-plus' as ModelId, name: 'GLM-4 Plus', icon: 'hub', capabilities: ['reasoning', 'code'] },
    ],
  },
};

// Work type to required capabilities mapping
const WORK_TYPE_CAPABILITIES: Record<string, Capability[]> = {
  'issue-agent:exploration': ['reasoning', 'large-context'],
  'issue-agent:planning': ['reasoning', 'code'],
  'issue-agent:implementation': ['code', 'reasoning'],
  'issue-agent:testing': ['code', 'reasoning'],
  'issue-agent:documentation': ['reasoning'],
  'issue-agent:review-response': ['reasoning', 'code'],
  'specialist-review-agent': ['reasoning', 'code'],
  'specialist-test-agent': ['code', 'reasoning'],
  'specialist-merge-agent': ['code'],
  'convoy:security-reviewer': ['reasoning', 'code'],
  'convoy:performance-reviewer': ['reasoning', 'code'],
  'convoy:correctness-reviewer': ['reasoning', 'code'],
  'convoy:synthesis-agent': ['reasoning'],
  'subagent:explore': ['fast', 'reasoning'],
  'subagent:plan': ['reasoning'],
  'subagent:bash': ['fast', 'code'],
  'subagent:general-purpose': ['reasoning', 'code'],
  'prd-agent': ['reasoning'],
  'decomposition-agent': ['reasoning'],
  'triage-agent': ['fast', 'reasoning'],
  'planning-agent': ['reasoning', 'code'],
  'cli:interactive': ['reasoning', 'code'],
  'cli:quick-command': ['fast'],
};

// Work type display names
const WORK_TYPE_NAMES: Record<string, string> = {
  'issue-agent:exploration': 'Exploration Phase',
  'issue-agent:planning': 'Planning Phase',
  'issue-agent:implementation': 'Implementation Phase',
  'issue-agent:testing': 'Testing Phase',
  'issue-agent:documentation': 'Documentation Phase',
  'issue-agent:review-response': 'Review Response Phase',
  'specialist-review-agent': 'Review Agent',
  'specialist-test-agent': 'Test Agent',
  'specialist-merge-agent': 'Merge Agent',
  'convoy:security-reviewer': 'Security Reviewer',
  'convoy:performance-reviewer': 'Performance Reviewer',
  'convoy:correctness-reviewer': 'Correctness Reviewer',
  'convoy:synthesis-agent': 'Synthesis Agent',
  'subagent:explore': 'Explore Subagent',
  'subagent:plan': 'Plan Subagent',
  'subagent:bash': 'Bash Subagent',
  'subagent:general-purpose': 'General Purpose Subagent',
  'prd-agent': 'PRD Agent',
  'decomposition-agent': 'Decomposition Agent',
  'triage-agent': 'Triage Agent',
  'planning-agent': 'Planning Agent',
  'cli:interactive': 'CLI Interactive',
  'cli:quick-command': 'CLI Quick Command',
};

// Capability display names
const CAPABILITY_NAMES: Record<Capability, string> = {
  'reasoning': 'Reasoning',
  'code': 'Code',
  'vision': 'Vision',
  'fast': 'Fast',
  'cost-efficient': 'Cost Efficient',
  'large-context': 'Large Context',
  'complex-math': 'Complex Math',
  'efficiency': 'Efficiency',
};

interface ModelOverrideModalProps {
  workType: WorkTypeId;
  currentModel: ModelId;
  isOverride: boolean;
  enabledProviders: string[];
  onApply: (model: ModelId) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ModelOverrideModal({
  workType,
  currentModel,
  isOverride,
  enabledProviders,
  onApply,
  onRemove,
  onClose,
}: ModelOverrideModalProps) {
  const [selectedModel, setSelectedModel] = useState<ModelId>(currentModel);

  const workTypeName = WORK_TYPE_NAMES[workType] || workType;
  const requiredCapabilities = WORK_TYPE_CAPABILITIES[workType] || ['reasoning'];

  // Filter providers based on enabled list
  const availableProviders = useMemo(() => {
    return Object.entries(MODELS_BY_PROVIDER).filter(([key]) =>
      key === 'anthropic' || enabledProviders.includes(key)
    );
  }, [enabledProviders]);

  // Find recommended model (best capability match)
  const recommendedModel = useMemo(() => {
    let bestMatch: { id: ModelId; score: number } | null = null;

    for (const [_providerKey, provider] of availableProviders) {
      for (const model of provider.models) {
        const matchingCaps = model.capabilities.filter(c => requiredCapabilities.includes(c));
        const score = matchingCaps.length / requiredCapabilities.length;
        // Prefer balanced tier for recommendations
        const tierBonus = model.tier === 'balanced' ? 0.1 : 0;
        const totalScore = score + tierBonus;

        if (!bestMatch || totalScore > bestMatch.score) {
          bestMatch = { id: model.id, score: totalScore };
        }
      }
    }
    return bestMatch?.id;
  }, [availableProviders, requiredCapabilities]);

  const handleApply = () => {
    onApply(selectedModel);
    onClose();
  };

  const hasChanges = selectedModel !== currentModel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-[640px] bg-[#0f172a] border border-slate-800 rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex justify-between items-start gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-white tracking-tight text-2xl font-bold">Select Model</h1>
              <p className="text-slate-400 text-sm">
                Task: <span className="text-cyan-400/80">{workTypeName}</span>
              </p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[500px]">
          {availableProviders.map(([providerKey, provider], providerIndex) => (
            <div key={providerKey} className="flex flex-col">
              {providerIndex > 0 && <div className="h-px bg-slate-800 mx-6 my-2" />}
              <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest px-6 pb-2 pt-6">
                {provider.name}
              </h3>

              {provider.models.map((model) => {
                const isSelected = selectedModel === model.id;
                const isRecommended = model.id === recommendedModel;
                const matchingCaps = model.capabilities.filter(c => requiredCapabilities.includes(c));

                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    className={`group flex items-center gap-4 px-6 py-4 cursor-pointer transition-all border-l-2 ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.1)]'
                        : isRecommended
                          ? 'bg-cyan-500/5 border-cyan-400/50 hover:bg-cyan-500/10'
                          : 'border-transparent hover:bg-slate-800/50'
                    }`}
                  >
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-10 transition-colors ${
                      isSelected || isRecommended ? 'bg-cyan-500/20' : 'bg-slate-800 group-hover:bg-slate-700'
                    }`}>
                      <span className={`material-symbols-outlined ${isSelected || isRecommended ? 'text-cyan-400' : 'text-slate-400'}`}>
                        {model.icon}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <p className={`text-white text-base ${isSelected ? 'font-bold' : 'font-medium'}`}>
                          {model.name}
                        </p>
                        {isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-400 text-[10px] text-slate-900 font-bold uppercase tracking-tight">
                            Recommended
                          </span>
                        )}
                        {model.tier === 'premium' && !isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                            Premium
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2 mt-1.5 flex-wrap">
                        {model.capabilities.map((cap) => {
                          const isMatching = matchingCaps.includes(cap);
                          return (
                            <span
                              key={cap}
                              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                                isMatching
                                  ? isSelected
                                    ? 'bg-cyan-500/20 text-white ring-1 ring-cyan-500/50'
                                    : 'border border-cyan-500/40 text-cyan-400'
                                  : 'border border-slate-700 text-slate-400'
                              }`}
                            >
                              {CAPABILITY_NAMES[cap]}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {isSelected && (
                      <span className="material-symbols-outlined text-cyan-400">check_circle</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/30 flex justify-between items-center">
          <div>
            {isOverride && (
              <button
                onClick={() => { onRemove(); onClose(); }}
                className="text-rose-400 hover:text-rose-300 text-sm font-medium transition-colors"
              >
                Remove Override
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-full text-slate-400 font-medium hover:text-white hover:bg-slate-800 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-8 py-2.5 rounded-full bg-cyan-400 text-slate-900 font-bold hover:bg-cyan-300 active:scale-95 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply Selection
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #22d3ee;
        }
      `}</style>
    </div>
  );
}
