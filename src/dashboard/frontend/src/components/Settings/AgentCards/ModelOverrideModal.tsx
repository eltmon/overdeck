import { useState, useMemo } from 'react';
import {
  type LucideIcon,
  Gem,
  Sparkles,
  Zap,
  Code2,
  Brain,
  FlaskConical,
  Layers,
  Globe,
  X,
  CheckCircle2,
  Star,
} from 'lucide-react';
import { WorkTypeId, ModelId } from '../types';

// Model capabilities that can be matched to work types
export type Capability = 'reasoning' | 'code' | 'vision' | 'fast' | 'cost-efficient' | 'large-context' | 'complex-math' | 'efficiency' | 'agentic';

export interface ModelDef {
  id: ModelId;
  name: string;
  icon: LucideIcon;
  tier?: 'premium' | 'balanced' | 'fast';
  capabilities: Capability[];
  description?: string;
}

interface ProviderDef {
  name: string;
  models: ModelDef[];
}

/**
 * Models grouped by provider
 *
 * IMPORTANT: This list MUST be kept in sync with MODEL_CAPABILITIES in src/lib/model-capabilities.ts
 * When adding new models to MODEL_CAPABILITIES, update this list as well.
 *
 * TODO: Consolidate to single source of truth by fetching from /api/settings/available-models
 * and deriving tier/capabilities from backend skill scores. Currently maintained separately
 * to preserve simplified capability taxonomy for UI (reasoning, code, etc.) vs backend's
 * detailed skill dimensions (code-generation, code-review, debugging, etc.)
 */
export const MODELS_BY_PROVIDER: Record<string, ProviderDef> = {
  anthropic: {
    name: 'Anthropic',
    models: [
      { id: 'claude-opus-4-6' as ModelId, name: 'Claude Opus 4.6', icon: Gem, tier: 'premium', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Most capable, best for complex tasks' },
      { id: 'claude-sonnet-4-6' as ModelId, name: 'Claude Sonnet 4.6', icon: Sparkles, tier: 'balanced', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Latest Sonnet — fast, capable, great for implementation' },
      { id: 'claude-sonnet-4-5' as ModelId, name: 'Claude Sonnet 4.5', icon: Sparkles, tier: 'balanced', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous gen Sonnet, strong coding performance' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5', icon: Zap, tier: 'fast', capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.4-pro' as ModelId, name: 'GPT-5.4 Pro', icon: Gem, tier: 'premium', capabilities: ['reasoning', 'code', 'complex-math', 'agentic'], description: 'Top-tier OpenAI coding and reasoning' },
      { id: 'gpt-5.4' as ModelId, name: 'GPT-5.4', icon: Code2, tier: 'balanced', capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Best everyday OpenAI implementation model' },
      { id: 'o3' as ModelId, name: 'O3', icon: Brain, tier: 'premium', capabilities: ['reasoning', 'code', 'complex-math'], description: 'Deep reasoning model for debugging and analysis' },
      { id: 'o4-mini' as ModelId, name: 'O4 Mini', icon: FlaskConical, tier: 'balanced', capabilities: ['reasoning', 'code', 'fast'], description: 'Fast reasoning model with strong code support' },
      { id: 'gpt-5.4-mini' as ModelId, name: 'GPT-5.4 Mini', icon: Layers, tier: 'fast', capabilities: ['fast', 'cost-efficient', 'code', 'reasoning'], description: 'Fast, cheap, and capable for high-volume work' },
      { id: 'gpt-5.4-nano' as ModelId, name: 'GPT-5.4 Nano', icon: Zap, tier: 'fast', capabilities: ['fast', 'cost-efficient'], description: 'Cheapest OpenAI lane for tiny helper tasks' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-3.1-pro-preview' as ModelId, name: 'Gemini 3.1 Pro', icon: Layers, tier: 'premium', capabilities: ['reasoning', 'large-context', 'code'], description: 'Google flagship with strong large-context reasoning' },
      { id: 'gemini-3-flash' as ModelId, name: 'Gemini 3 Flash', icon: Zap, tier: 'balanced', capabilities: ['fast', 'large-context', 'code'], description: 'Fast large-context model for exploration-heavy work' },
      { id: 'gemini-3.1-flash-lite-preview' as ModelId, name: 'Gemini 3.1 Flash Lite', icon: Zap, tier: 'fast', capabilities: ['fast', 'cost-efficient', 'large-context'], description: 'Lowest-cost Gemini lane' },
    ],
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    models: [
      { id: 'K2.6-code-preview' as ModelId, name: 'K2.6-code-preview', icon: Layers, tier: 'premium', capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Latest Kimi coding preview model' },
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', icon: Layers, tier: 'premium', capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Best-value implementation model, 256K context' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'minimax-m2.7' as ModelId, name: 'MiniMax M2.7', icon: Globe, tier: 'balanced', capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Anthropic-compatible coding model with strong value' },
      { id: 'minimax-m2.7-highspeed' as ModelId, name: 'MiniMax M2.7 Highspeed', icon: Zap, tier: 'fast', capabilities: ['reasoning', 'code', 'agentic', 'large-context', 'fast'], description: 'Same MiniMax quality tier with higher throughput' },
    ],
  },
  zai: {
    name: 'Z.AI',
    models: [
      { id: 'glm-5.1' as ModelId, name: 'GLM 5.1', icon: Globe, tier: 'balanced', capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Z.AI direct provider for GLM 5.1' },
    ],
  },
};

// Work type to required capabilities mapping
export const WORK_TYPE_CAPABILITIES: Record<string, Capability[]> = {
  'issue-agent:exploration': ['reasoning', 'large-context'],
  'issue-agent:implementation': ['code', 'reasoning', 'agentic'],
  'issue-agent:testing': ['code', 'reasoning'],
  'issue-agent:documentation': ['reasoning'],
  'issue-agent:review-response': ['reasoning', 'code'],
  'specialist-review-agent': ['reasoning', 'code'],
  'specialist-test-agent': ['code', 'reasoning'],
  'specialist-merge-agent': ['code'],
  'specialist-inspect-agent': ['reasoning', 'code'],
  'specialist-uat-agent': ['reasoning', 'code'],
  'convoy:security-reviewer': ['reasoning', 'code'],
  'convoy:performance-reviewer': ['reasoning', 'code'],
  'convoy:correctness-reviewer': ['reasoning', 'code'],
  'convoy:synthesis-agent': ['reasoning'],
  'subagent:explore': ['fast', 'reasoning'],
  'subagent:plan': ['reasoning'],
  'subagent:bash': ['fast', 'code'],
  'subagent:general-purpose': ['reasoning', 'code'],
  'planning-agent': ['reasoning'],
  'status-review': ['reasoning'],
  'cli:interactive': ['reasoning', 'code'],
  'cli:quick-command': ['fast'],
};

// Work type display names
export const WORK_TYPE_NAMES: Record<string, string> = {
  'issue-agent:exploration': 'Exploration Phase',
  'issue-agent:implementation': 'Implementation Phase',
  'issue-agent:testing': 'Testing Phase',
  'issue-agent:documentation': 'Documentation Phase',
  'issue-agent:review-response': 'Review Response Phase',
  'specialist-review-agent': 'Review Agent',
  'specialist-test-agent': 'Test Agent',
  'specialist-merge-agent': 'Merge Agent',
  'specialist-inspect-agent': 'Inspect Agent',
  'specialist-uat-agent': 'UAT Agent',
  'convoy:security-reviewer': 'Security Reviewer',
  'convoy:performance-reviewer': 'Performance Reviewer',
  'convoy:correctness-reviewer': 'Correctness Reviewer',
  'convoy:synthesis-agent': 'Synthesis Agent',
  'subagent:explore': 'Explore Subagent',
  'subagent:plan': 'Plan Subagent',
  'subagent:bash': 'Bash Subagent',
  'subagent:general-purpose': 'General Purpose Subagent',
  'planning-agent': 'Planning Agent',
  'status-review': 'Status Review',
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
  if (idLower.includes('opus') && idLower.includes('4')) return models.find(m => m.id === 'claude-opus-4-6');
  if (idLower.includes('sonnet') && idLower.includes('4.6')) return models.find(m => m.id === 'claude-sonnet-4-6');
  if (idLower.includes('sonnet') && idLower.includes('4')) return models.find(m => m.id === 'claude-sonnet-4-6');
  if (idLower.includes('haiku')) return models.find(m => m.id === 'claude-haiku-4-5');
  if (idLower.includes('claude') && !idLower.includes('opus') && !idLower.includes('haiku')) return models.find(m => m.id === 'claude-sonnet-4-6');

  // OpenAI models
  if (idLower.includes('gpt-5.4-pro')) return models.find(m => m.id === 'gpt-5.4-pro');
  if (idLower.includes('gpt-5.4') && idLower.includes('mini')) return models.find(m => m.id === 'gpt-5.4-mini');
  if (idLower.includes('gpt-5.4') && idLower.includes('nano')) return models.find(m => m.id === 'gpt-5.4-nano');
  if (idLower.includes('gpt-5.4') || idLower.includes('gpt-5.2-codex')) return models.find(m => m.id === 'gpt-5.4');
  if (idLower.includes('gpt-4o-mini')) return models.find(m => m.id === 'gpt-5.4-nano');
  if (idLower.includes('gpt-4o') || idLower === 'gpt4o') return models.find(m => m.id === 'gpt-5.4-mini');
  if (idLower.includes('o4') && idLower.includes('mini')) return models.find(m => m.id === 'o4-mini');
  if (idLower.includes('o3')) return models.find(m => m.id === 'o3');

  // Google models
  if (idLower.includes('gemini') && idLower.includes('lite')) return models.find(m => m.id === 'gemini-3.1-flash-lite-preview');
  if (idLower.includes('gemini') && idLower.includes('flash')) return models.find(m => m.id === 'gemini-3-flash');
  if (idLower.includes('gemini')) return models.find(m => m.id === 'gemini-3.1-pro-preview');

  // Kimi models
  if (id === 'K2.6-code-preview') return models.find(m => m.id === 'K2.6-code-preview');
  if (idLower.includes('kimi') || idLower.includes('moonshot')) {
    return models.find(m => m.id === 'kimi-k2.5');
  }

  // MiniMax models
  if (idLower.includes('minimax')) {
    if (idLower.includes('highspeed')) return models.find(m => m.id === 'minimax-m2.7-highspeed');
    return models.find(m => m.id === 'minimax-m2.7');
  }

  // Z.AI models
  if (idLower.includes('glm') || idLower.includes('zai')) {
    return models.find(m => m.id === 'glm-5.1');
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

export type OpenRouterFavoriteModel = {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
  supportsThinking: boolean;
  category: string;
};

interface ModelOverrideModalProps {
  workType: WorkTypeId;
  currentModel: ModelId;
  isOverride: boolean;
  enabledProviders: string[];
  openRouterFavorites?: OpenRouterFavoriteModel[];
  onApply: (model: ModelId) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ModelOverrideModal({
  workType,
  currentModel,
  isOverride,
  enabledProviders,
  openRouterFavorites,
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

  // Build display list: base providers + OpenRouter favorites section
  const displayProviders = useMemo(() => {
    const base = availableProviders.map(([key, provider]) => ({
      key,
      name: provider.name,
      models: provider.models,
    }));
    if (openRouterFavorites && openRouterFavorites.length > 0) {
      base.push({
        key: 'openrouter',
        name: 'OpenRouter (Favorites)',
        models: openRouterFavorites.map((m) => ({
          id: m.id as ModelId,
          name: m.name,
          icon: Star,
          tier: 'premium' as const,
          capabilities: ['reasoning', 'code'] as Capability[],
          description: `Context: ${(m.contextLength / 1000).toFixed(0)}K · Thinking: ${m.supportsThinking ? 'Yes' : 'No'}`,
        })),
      });
    }
    return base;
  }, [availableProviders, openRouterFavorites]);

  // Find recommended model (best capability match)
  const recommendedModel = useMemo(() => {
    let bestMatch: { id: ModelId; score: number } | null = null;

    for (const provider of displayProviders) {
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
  }, [displayProviders, requiredCapabilities]);

  const handleApply = () => {
    onApply(selectedModel);
    onClose();
  };

  const hasChanges = selectedModel !== currentModel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-[680px] bg-surface border border-divider rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-divider">
          <div className="flex justify-between items-start gap-3">
            <div className="flex flex-col gap-2">
              <h1 className="text-content tracking-tight text-2xl font-bold">Select Model</h1>
              <div className="flex items-center gap-3">
                <span className="text-content-muted text-sm">Task:</span>
                <span className="text-blue-400 font-medium">{workTypeName}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-content-muted text-xs">Needs:</span>
                {requiredCapabilities.map(cap => (
                  <span key={cap} className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-medium">
                    {CAPABILITY_INFO[cap].name}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="text-content-muted hover:text-content transition-colors p-1" aria-label="Close model picker">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[450px]">
          {displayProviders.map((provider, providerIndex) => (
            <div key={provider.key} className="flex flex-col">
              {providerIndex > 0 && <div className="h-px bg-divider mx-6 my-2" />}
              <h3 className="text-content-muted text-xs font-bold uppercase tracking-widest px-6 pb-2 pt-5">
                {provider.name}
              </h3>

              {provider.models.map((model) => {
                const isSelected = selectedModel === model.id;
                const isRecommended = model.id === recommendedModel;
                const matchingCaps = model.capabilities.filter(c => requiredCapabilities.includes(c));
                const matchScore = matchingCaps.length / requiredCapabilities.length;
                const isFavorite = provider.key === 'openrouter';

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
                          : 'border-transparent hover:bg-surface-overlay'
                    }`}
                  >
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-10 transition-colors ${
                      isSelected || isRecommended ? 'bg-blue-500/20' : 'bg-surface-emphasis group-hover:bg-divider'
                    }`}>
                      <model.icon className={`w-5 h-5 ${isSelected || isRecommended ? 'text-blue-400' : 'text-content-muted'}`} />
                    </div>

                    <div className="flex flex-1 flex-col justify-center min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-content text-sm ${isSelected ? 'font-bold' : 'font-medium'} truncate`}>
                          {model.name}
                        </p>
                        {isFavorite && !isRecommended && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-[9px] text-amber-400 font-bold uppercase tracking-tight shrink-0">
                            <Star className="w-2.5 h-2.5 fill-amber-400" />
                            Favorite
                          </span>
                        )}
                        {isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-500 text-[9px] text-content font-bold uppercase tracking-tight shrink-0">
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
                                  : 'bg-surface-emphasis text-content-subtle border border-divider'
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
                        <span className="text-content-muted text-xs font-bold">{Math.round(matchScore * 100)}%</span>
                      )}
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-blue-400" />}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-divider bg-surface flex justify-between items-center">
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
              className="px-5 py-2 rounded-lg text-content-muted font-medium hover:text-content hover:bg-surface-overlay transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-6 py-2 rounded-lg bg-blue-500 text-content font-bold hover:bg-blue-400 active:scale-95 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
          background: var(--color-overlay);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3b82f6;
        }
      `}</style>
    </div>
  );
}
