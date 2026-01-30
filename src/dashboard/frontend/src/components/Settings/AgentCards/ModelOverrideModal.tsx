import { useState, useMemo } from 'react';
import { WorkTypeId, ModelId } from '../types';

// Model definitions grouped by provider - matching Stitch design
const MODELS_BY_PROVIDER = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-5' as ModelId, name: 'Claude Opus 4.5', tier: 'premium' },
      { id: 'claude-sonnet-4-5' as ModelId, name: 'Claude Sonnet 4.5', tier: 'standard', isNew: true },
      { id: 'claude-haiku-3-5' as ModelId, name: 'Claude Haiku', tier: 'fast' },
    ],
  },
  kimi: {
    name: 'Kimi',
    models: [
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', tier: 'standard' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', tier: 'standard' },
      { id: 'o1' as ModelId, name: 'o1', tier: 'premium' },
      { id: 'o3-mini' as ModelId, name: 'o3-mini', tier: 'fast' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-2.5-pro' as ModelId, name: 'Gemini 2.5 Pro', tier: 'premium' },
      { id: 'gemini-2.5-flash' as ModelId, name: 'Gemini 2.5 Flash', tier: 'fast' },
    ],
  },
  zai: {
    name: 'Z.AI',
    models: [
      { id: 'glm-4-plus' as ModelId, name: 'GLM-4 Plus', tier: 'standard' },
    ],
  },
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
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Get display name for work type
  const workTypeName = WORK_TYPE_NAMES[workType] || workType;

  // Get agent name from work type
  const agentName = useMemo(() => {
    if (workType.startsWith('issue-agent:')) return 'Issue Agent';
    if (workType.startsWith('specialist-')) return workType.replace('specialist-', '').replace('-agent', ' Agent');
    if (workType.startsWith('convoy:')) return 'Convoy';
    if (workType.startsWith('subagent:')) return 'Subagent';
    if (workType.endsWith('-agent')) return workType.replace('-agent', ' Agent');
    if (workType.startsWith('cli:')) return 'CLI';
    return 'Agent';
  }, [workType]);

  // Filter available models based on enabled providers
  const availableProviders = useMemo(() => {
    return Object.entries(MODELS_BY_PROVIDER).filter(([key]) =>
      key === 'anthropic' || enabledProviders.includes(key)
    );
  }, [enabledProviders]);

  // Get current model info
  const selectedModelInfo = useMemo(() => {
    for (const provider of Object.values(MODELS_BY_PROVIDER)) {
      const model = provider.models.find(m => m.id === selectedModel);
      if (model) return { ...model, provider: provider.name };
    }
    return { id: selectedModel, name: selectedModel, tier: 'standard', provider: 'Unknown' };
  }, [selectedModel]);

  const handleApply = () => {
    onApply(selectedModel);
    onClose();
  };

  const handleRemove = () => {
    onRemove();
    onClose();
  };

  const hasChanges = selectedModel !== currentModel;

  // Calculate a mock capability match percentage based on model tier
  const capabilityMatch = useMemo(() => {
    const tierScores: Record<string, number> = { premium: 98, standard: 92, fast: 85 };
    return tierScores[selectedModelInfo.tier as string] || 90;
  }, [selectedModelInfo.tier]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      {/* Modal Container */}
      <div className="w-full max-w-[500px] bg-[#24283b] border border-[#414868] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-white text-2xl font-bold leading-tight">Configure Model Override</h2>
          <p className="text-[#a390cb] text-sm font-medium mt-1">{agentName}: {workTypeName}</p>
        </div>

        {/* Content Area */}
        <div className="px-6 py-2 flex flex-col gap-6 overflow-y-auto max-h-[70vh] custom-scrollbar">
          {/* Current Model Section */}
          <div className="flex flex-col gap-2">
            <h3 className="text-white text-sm font-bold tracking-tight">Current Model</h3>
            <div className="flex">
              <div className="flex h-8 shrink-0 items-center justify-center gap-x-2 rounded-full bg-emerald-500/20 border border-emerald-500/30 px-4">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                <p className="text-emerald-400 text-xs font-bold leading-normal">{selectedModelInfo.name}</p>
                {isOverride && (
                  <span className="text-[10px] bg-[#a078f7]/20 text-[#a078f7] px-1.5 rounded">override</span>
                )}
              </div>
            </div>
          </div>

          {/* Select Model Dropdown */}
          <div className="flex flex-col gap-2">
            <h3 className="text-white text-sm font-bold tracking-tight">Select Model</h3>
            <div className="relative">
              {/* Dropdown Trigger */}
              <div
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex w-full items-center justify-between rounded-lg bg-[#1a1c2c] border border-[#414868] px-4 py-3 cursor-pointer hover:border-[#a078f7] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#a078f7] text-xl">psychology</span>
                  <span className="text-white text-sm">{selectedModelInfo.name}</span>
                </div>
                <span className={`material-symbols-outlined text-[#a390cb] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </div>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 w-full bg-[#1a1c2c] border border-[#414868] rounded-lg shadow-xl overflow-hidden z-10">
                  <div className="max-h-64 overflow-y-auto custom-scrollbar py-2">
                    {availableProviders.map(([key, provider]) => (
                      <div key={key}>
                        {/* Provider Header */}
                        <div className="px-4 py-2 text-[10px] font-bold text-[#a390cb] uppercase tracking-widest">
                          {provider.name}
                        </div>
                        {/* Models */}
                        {provider.models.map((model) => {
                          const isSelected = selectedModel === model.id;
                          return (
                            <div
                              key={model.id}
                              onClick={() => {
                                setSelectedModel(model.id);
                                setIsDropdownOpen(false);
                              }}
                              className={`px-4 py-2 text-sm cursor-pointer flex justify-between items-center ${
                                isSelected
                                  ? 'text-[#a078f7] bg-[#a078f7]/10 border-l-2 border-[#a078f7]'
                                  : 'text-gray-300 hover:bg-[#a078f7]/20 hover:text-white'
                              }`}
                            >
                              <span>{model.name}</span>
                              <div className="flex items-center gap-2">
                                {'isNew' in model && model.isNew && (
                                  <span className="text-[10px] bg-[#a078f7]/20 text-[#a078f7] px-1.5 rounded">New</span>
                                )}
                                {isSelected && (
                                  <span className="material-symbols-outlined text-sm">check</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Capability Match */}
          <div className="flex flex-col gap-3 p-4 rounded-lg bg-[#2e2249]/30 border border-[#a078f7]/10">
            <div className="flex justify-between items-center">
              <h3 className="text-white text-sm font-bold">Capability Match</h3>
              <span className="text-[#a078f7] text-sm font-bold">{capabilityMatch}%</span>
            </div>
            <div className="w-full bg-[#1a1c2c] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#a078f7] h-full rounded-full transition-all duration-300"
                style={{ width: `${capabilityMatch}%` }}
              />
            </div>
            <p className="text-[#a390cb] text-xs">
              {capabilityMatch >= 95
                ? 'Excellent match for this work type.'
                : capabilityMatch >= 90
                  ? 'High match for exploration and reasoning tasks.'
                  : 'Good match with some capability trade-offs.'}
            </p>
          </div>

          {/* Info Note */}
          <div className="flex items-start gap-3 bg-blue-500/10 p-3 rounded-lg">
            <span className="material-symbols-outlined text-blue-400 text-lg mt-0.5">info</span>
            <p className="text-[#a390cb] text-xs leading-relaxed">
              This override will be used instead of smart selection for this work type. It may impact performance or cost efficiency.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-6 mt-4 border-t border-[#414868] flex items-center justify-between">
          {isOverride ? (
            <button
              onClick={handleRemove}
              className="text-rose-400 hover:text-rose-300 text-sm font-bold transition-colors"
            >
              Remove Override
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-white text-sm font-bold hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-6 py-2.5 rounded-lg bg-[#a078f7] text-white text-sm font-bold hover:bg-[#b18df9] transition-all shadow-lg shadow-[#a078f7]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Apply Override
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #2e2249;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #414868;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #a078f7;
        }
      `}</style>
    </div>
  );
}
