import { useState, useMemo } from 'react';
import { WorkTypeId, ModelId } from '../types';

// Model capabilities that can be matched to work types
export type Capability = 'reasoning' | 'code' | 'vision' | 'fast' | 'cost-efficient' | 'large-context' | 'complex-math' | 'efficiency' | 'agentic';

export interface ModelDef {
  id: ModelId;
  name: string;
  icon: string;
  tier?: 'premium' | 'balanced' | 'fast';
  capabilities: Capability[];
  description?: string;
}

interface ProviderDef {
  name: string;
  models: ModelDef[];
}

// Models grouped by provider
export const MODELS_BY_PROVIDER: Record<string, ProviderDef> = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-5' as ModelId, name: 'Claude Opus 4.5', icon: 'diamond', tier: 'premium', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Most capable, best for complex tasks' },
      { id: 'claude-sonnet-4-5' as ModelId, name: 'Claude Sonnet 4.5', icon: 'auto_awesome', tier: 'balanced', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Great balance of speed and capability' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', icon: 'science', tier: 'balanced', capabilities: ['reasoning', 'code', 'vision'], description: 'Versatile multimodal model' },
      { id: 'o1' as ModelId, name: 'o1', icon: 'psychology', tier: 'premium', capabilities: ['reasoning', 'complex-math'], description: 'Deep reasoning, slower responses' },
      { id: 'o3-mini' as ModelId, name: 'o3-mini', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'reasoning', 'code'], description: 'Fast reasoning model' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-2.5-pro' as ModelId, name: 'Gemini 2.5 Pro', icon: 'model_training', tier: 'premium', capabilities: ['reasoning', 'large-context', 'code'], description: '1M context, great for large codebases' },
      { id: 'gemini-2.5-flash' as ModelId, name: 'Gemini 2.5 Flash', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'cost-efficient', 'reasoning'], description: 'Fast and affordable' },
    ],
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    models: [
      { id: 'kimi-k2' as ModelId, name: 'Kimi K2', icon: 'token', tier: 'premium', capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Top-tier coding, 128K context' },
      { id: 'kimi-k2-turbo' as ModelId, name: 'Kimi K2 Turbo', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'code', 'efficiency'], description: 'Fast coding assistant' },
    ],
  },
  zai: {
    name: 'Zhipu (GLM)',
    models: [
      { id: 'glm-4-plus' as ModelId, name: 'GLM-4 Plus', icon: 'hub', tier: 'premium', capabilities: ['reasoning', 'code'], description: 'Flagship reasoning model' },
      { id: 'glm-4-air' as ModelId, name: 'GLM-4 Air', icon: 'cloud', tier: 'balanced', capabilities: ['reasoning', 'code', 'efficiency'], description: 'Balanced speed and quality' },
      { id: 'glm-4-flash' as ModelId, name: 'GLM-4 Flash', icon: 'bolt', tier: 'fast', capabilities: ['fast', 'cost-efficient'], description: 'Ultra-fast responses' },
      { id: 'glm-4-long' as ModelId, name: 'GLM-4 Long', icon: 'format_list_bulleted', tier: 'balanced', capabilities: ['large-context', 'reasoning'], description: '1M token context window' },
    ],
  },
};

// Work type to required capabilities mapping
export const WORK_TYPE_CAPABILITIES: Record<string, Capability[]> = {
  'issue-agent:exploration': ['reasoning', 'large-context'],
  'issue-agent:planning': ['reasoning', 'code'],
  'issue-agent:implementation': ['code', 'reasoning', 'agentic'],
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
export const WORK_TYPE_NAMES: Record<string, string> = {
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

// Capability display names and icons
export const CAPABILITY_INFO: Record<Capability, { name: string; icon: string; description: string }> = {
  'reasoning': { name: 'Reasoning', icon: 'psychology', description: 'Complex problem solving' },
  'code': { name: 'Code', icon: 'code', description: 'Code generation & analysis' },
  'vision': { name: 'Vision', icon: 'visibility', description: 'Image understanding' },
  'fast': { name: 'Fast', icon: 'bolt', description: 'Quick response times' },
  'cost-efficient': { name: 'Cheap', icon: 'savings', description: 'Low token cost' },
  'large-context': { name: 'Large Context', icon: 'unfold_more', description: '100K+ token window' },
  'complex-math': { name: 'Math', icon: 'calculate', description: 'Advanced mathematics' },
  'efficiency': { name: 'Efficient', icon: 'eco', description: 'Good value for capability' },
  'agentic': { name: 'Agentic', icon: 'smart_toy', description: 'Multi-step tool use' },
};

// Helper to get all models as flat list
export function getAllModels(): ModelDef[] {
  return Object.values(MODELS_BY_PROVIDER).flatMap(p => p.models);
}

// Helper to find model by ID (with fuzzy matching for backend compatibility)
export function getModelById(id: ModelId): ModelDef | undefined {
  const models = getAllModels();

  // First try exact match
  const exact = models.find(m => m.id === id);
  if (exact) return exact;

  // Fuzzy matching for backend model ID variations
  const idLower = id.toLowerCase();

  // Anthropic models
  if (idLower.includes('opus') && idLower.includes('4')) return models.find(m => m.id === 'claude-opus-4-5');
  if (idLower.includes('sonnet') && idLower.includes('4')) return models.find(m => m.id === 'claude-sonnet-4-5');
  if (idLower.includes('haiku')) return models.find(m => m.id === 'claude-haiku-4-5');
  if (idLower.includes('claude') && !idLower.includes('opus') && !idLower.includes('haiku')) return models.find(m => m.id === 'claude-sonnet-4-5');

  // OpenAI models
  if (idLower.includes('gpt-4o') || idLower === 'gpt4o') return models.find(m => m.id === 'gpt-4o');
  if (idLower.includes('o1') && !idLower.includes('o3')) return models.find(m => m.id === 'o1');
  if (idLower.includes('o3')) return models.find(m => m.id === 'o3-mini');

  // Google models
  if (idLower.includes('gemini') && idLower.includes('flash')) return models.find(m => m.id === 'gemini-2.5-flash');
  if (idLower.includes('gemini')) return models.find(m => m.id === 'gemini-2.5-pro');

  // Kimi models
  if (idLower.includes('kimi') || idLower.includes('moonshot')) {
    if (idLower.includes('turbo') || idLower.includes('fast')) return models.find(m => m.id === 'kimi-k2-turbo');
    return models.find(m => m.id === 'kimi-k2');
  }

  // GLM models
  if (idLower.includes('glm') || idLower.includes('zhipu') || idLower.includes('chatglm')) {
    if (idLower.includes('flash')) return models.find(m => m.id === 'glm-4-flash');
    if (idLower.includes('air')) return models.find(m => m.id === 'glm-4-air');
    if (idLower.includes('long') || idLower.includes('1m')) return models.find(m => m.id === 'glm-4-long');
    return models.find(m => m.id === 'glm-4-plus');
  }

  return undefined;
}

// Helper to calculate capability match score
export function getCapabilityMatchScore(modelId: ModelId, workType: string): { score: number; matched: Capability[]; missing: Capability[] } {
  const model = getModelById(modelId);
  const required = WORK_TYPE_CAPABILITIES[workType] || ['reasoning'];

  if (!model) return { score: 0, matched: [], missing: required };

  const matched = required.filter(c => model.capabilities.includes(c));
  const missing = required.filter(c => !model.capabilities.includes(c));

  return {
    score: required.length > 0 ? matched.length / required.length : 0,
    matched,
    missing,
  };
}

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
      <div className="w-full max-w-[680px] bg-[#0f172a] border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800">
          <div className="flex justify-between items-start gap-3">
            <div className="flex flex-col gap-2">
              <h1 className="text-white tracking-tight text-2xl font-bold">Select Model</h1>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-sm">Task:</span>
                <span className="text-blue-400 font-medium">{workTypeName}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-slate-500 text-xs">Needs:</span>
                {requiredCapabilities.map(cap => (
                  <span key={cap} className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-medium">
                    {CAPABILITY_INFO[cap].name}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[450px]">
          {availableProviders.map(([providerKey, provider], providerIndex) => (
            <div key={providerKey} className="flex flex-col">
              {providerIndex > 0 && <div className="h-px bg-slate-800 mx-6 my-2" />}
              <h3 className="text-slate-500 text-xs font-bold uppercase tracking-widest px-6 pb-2 pt-5">
                {provider.name}
              </h3>

              {provider.models.map((model) => {
                const isSelected = selectedModel === model.id;
                const isRecommended = model.id === recommendedModel;
                const matchingCaps = model.capabilities.filter(c => requiredCapabilities.includes(c));
                const matchScore = matchingCaps.length / requiredCapabilities.length;

                return (
                  <div
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    title={model.description}
                    className={`group flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-all border-l-2 ${
                      isSelected
                        ? 'bg-blue-500/10 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.1)]'
                        : isRecommended
                          ? 'bg-blue-500/5 border-blue-400/50 hover:bg-blue-500/10'
                          : 'border-transparent hover:bg-slate-800/50'
                    }`}
                  >
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-10 transition-colors ${
                      isSelected || isRecommended ? 'bg-blue-500/20' : 'bg-slate-800 group-hover:bg-slate-700'
                    }`}>
                      <span className={`material-symbols-outlined text-xl ${isSelected || isRecommended ? 'text-blue-400' : 'text-slate-400'}`}>
                        {model.icon}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col justify-center min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-white text-sm ${isSelected ? 'font-bold' : 'font-medium'} truncate`}>
                          {model.name}
                        </p>
                        {isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-500 text-[9px] text-white font-bold uppercase tracking-tight shrink-0">
                            Best Fit
                          </span>
                        )}
                        {model.tier === 'premium' && !isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-[9px] text-amber-400 font-bold uppercase tracking-tight shrink-0">
                            Premium
                          </span>
                        )}
                        {model.tier === 'fast' && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[9px] text-emerald-400 font-bold uppercase tracking-tight shrink-0">
                            Fast
                          </span>
                        )}
                      </div>

                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {model.capabilities.map((cap) => {
                          const isMatching = matchingCaps.includes(cap);
                          return (
                            <span
                              key={cap}
                              title={CAPABILITY_INFO[cap].description}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                isMatching
                                  ? 'bg-blue-500/20 text-blue-300'
                                  : 'bg-slate-800 text-slate-500'
                              }`}
                            >
                              {CAPABILITY_INFO[cap].name}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Match indicator */}
                    <div className="flex items-center gap-2 shrink-0">
                      {matchScore === 1 ? (
                        <span className="text-emerald-400 text-xs font-bold">100%</span>
                      ) : matchScore >= 0.5 ? (
                        <span className="text-amber-400 text-xs font-bold">{Math.round(matchScore * 100)}%</span>
                      ) : (
                        <span className="text-slate-500 text-xs font-bold">{Math.round(matchScore * 100)}%</span>
                      )}
                      {isSelected && (
                        <span className="material-symbols-outlined text-blue-400">check_circle</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex justify-between items-center">
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
              className="px-5 py-2 rounded-lg text-slate-400 font-medium hover:text-white hover:bg-slate-800 transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-6 py-2 rounded-lg bg-blue-500 text-white font-bold hover:bg-blue-400 active:scale-95 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
          background: #3b82f6;
        }
      `}</style>
    </div>
  );
}
