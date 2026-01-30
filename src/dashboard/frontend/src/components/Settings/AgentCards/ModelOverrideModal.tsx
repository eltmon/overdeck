import { useState, useMemo } from 'react';
import { X, Check, ChevronDown, Info, AlertTriangle } from 'lucide-react';
import { WorkTypeId, ModelId } from '../types';

// Model definitions grouped by provider
const MODELS_BY_PROVIDER = {
  anthropic: {
    name: 'Anthropic',
    icon: 'auto_awesome',
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/30',
    models: [
      { id: 'claude-opus-4-5' as ModelId, name: 'Claude Opus 4.5', tier: 'premium' },
      { id: 'claude-sonnet-4-5' as ModelId, name: 'Claude Sonnet 4.5', tier: 'standard' },
      { id: 'claude-haiku-3-5' as ModelId, name: 'Claude Haiku 3.5', tier: 'fast' },
    ],
  },
  kimi: {
    name: 'Kimi',
    icon: 'rocket_launch',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/30',
    models: [
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', tier: 'standard' },
    ],
  },
  openai: {
    name: 'OpenAI',
    icon: 'bolt',
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/30',
    models: [
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', tier: 'standard' },
      { id: 'o1' as ModelId, name: 'o1', tier: 'premium' },
      { id: 'o3-mini' as ModelId, name: 'o3-mini', tier: 'fast' },
    ],
  },
  google: {
    name: 'Google',
    icon: 'google',
    color: 'text-purple-400',
    bgColor: 'bg-purple-900/30',
    models: [
      { id: 'gemini-2.5-pro' as ModelId, name: 'Gemini 2.5 Pro', tier: 'premium' },
      { id: 'gemini-2.5-flash' as ModelId, name: 'Gemini 2.5 Flash', tier: 'fast' },
    ],
  },
  zai: {
    name: 'Z.AI',
    icon: 'api',
    color: 'text-red-400',
    bgColor: 'bg-red-900/30',
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
  const currentModelInfo = useMemo(() => {
    for (const provider of Object.values(MODELS_BY_PROVIDER)) {
      const model = provider.models.find(m => m.id === selectedModel);
      if (model) return { ...model, provider: provider.name, color: provider.color };
    }
    return { id: selectedModel, name: selectedModel, tier: 'standard', provider: 'Unknown', color: 'text-gray-400' };
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[#24283b] border border-[#414868] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#414868]">
          <div>
            <h2 className="text-xl font-semibold text-white">Configure Model Override</h2>
            <p className="text-sm text-[#8b7aa0] mt-1">{agentName}: {workTypeName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-[#8b7aa0] hover:text-white hover:bg-[#414868] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Current Model */}
          <div>
            <label className="block text-sm font-medium text-[#c4b5d4] mb-2">Current Model</label>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${currentModelInfo.color} bg-[#2d2640]`}>
              <span className="font-medium">{currentModelInfo.name}</span>
              {isOverride && (
                <span className="text-xs bg-[#a078f7]/20 text-[#a078f7] px-2 py-0.5 rounded-full">override</span>
              )}
            </div>
          </div>

          {/* Model Selector */}
          <div className="relative">
            <label className="block text-sm font-medium text-[#c4b5d4] mb-2">Select Model</label>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full flex items-center justify-between px-4 py-3 bg-[#1a1625] border border-[#414868] rounded-lg text-white hover:border-[#a078f7] transition-colors"
            >
              <span>{currentModelInfo.name}</span>
              <ChevronDown className={`w-5 h-5 text-[#8b7aa0] transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1625] border border-[#414868] rounded-lg shadow-xl max-h-64 overflow-y-auto custom-scrollbar z-10">
                {availableProviders.map(([key, provider]) => (
                  <div key={key}>
                    {/* Provider Header */}
                    <div className={`flex items-center gap-2 px-4 py-2 ${provider.bgColor} border-b border-[#2d2640]`}>
                      <span className={`material-symbols-outlined text-base ${provider.color}`}>{provider.icon}</span>
                      <span className={`text-xs font-semibold uppercase tracking-wider ${provider.color}`}>
                        {provider.name}
                      </span>
                    </div>
                    {/* Models */}
                    {provider.models.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id);
                          setIsDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#2d2640] transition-colors ${
                          selectedModel === model.id ? 'bg-[#a078f7]/10' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white">{model.name}</span>
                          {model.tier === 'premium' && (
                            <span className="text-xs bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded">premium</span>
                          )}
                          {model.tier === 'fast' && (
                            <span className="text-xs bg-cyan-900/30 text-cyan-400 px-1.5 py-0.5 rounded">fast</span>
                          )}
                        </div>
                        {selectedModel === model.id && (
                          <Check className="w-4 h-4 text-[#a078f7]" />
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 p-3 bg-[#1a1625] rounded-lg">
            <Info className="w-4 h-4 text-[#8b7aa0] mt-0.5 flex-shrink-0" />
            <p className="text-sm text-[#8b7aa0]">
              This override will be used instead of smart selection for this work type.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-[#414868] bg-[#1a1625]">
          <div>
            {isOverride && (
              <button
                onClick={handleRemove}
                className="flex items-center gap-2 px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <AlertTriangle className="w-4 h-4" />
                Remove Override
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[#c4b5d4] hover:text-white hover:bg-[#414868] rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-5 py-2 bg-[#a078f7] hover:bg-[#b088ff] text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
