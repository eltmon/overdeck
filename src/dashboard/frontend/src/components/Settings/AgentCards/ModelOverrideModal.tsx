import { useState, useMemo, useEffect } from 'react';
import {
  type LucideIcon,
  Gem,
  Sparkles,
  Zap,
  FlaskConical,
  Layers,
  Network,
  Globe,
  X,
  CheckCircle2,
  Star,
} from 'lucide-react';
import { WorkTypeId, ModelId, Harness } from '../types';
import { CostWarningBadge, costWarningLevel } from '../../shared/costWarning';
import { canUsePickerHarness, HarnessSelect } from '../../shared/ModelPicker';
import type { HarnessPolicyDecisions, ModelGroup } from '../../shared/ModelPicker';

// Model capabilities that can be matched to work types
export type Capability = 'reasoning' | 'code' | 'vision' | 'fast' | 'cost-efficient' | 'large-context' | 'complex-math' | 'efficiency' | 'agentic';

export interface ModelDef {
  id: ModelId;
  name: string;
  icon: LucideIcon;
  tier?: 'premium' | 'balanced' | 'fast';
  capabilities: Capability[];
  description?: string;
  /**
   * Blended $/1M tokens. Used to flag expensive models with a scary warning
   * badge so users don't accidentally pick gpt-5.5-pro ($119) when they meant
   * gpt-5.5 ($10).
   */
  costPer1MTokens?: number;
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
      { id: 'claude-opus-4-7' as ModelId, name: 'Claude Opus 4.7', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Most capable — xhigh/max effort, deepest reasoning' },
      { id: 'claude-opus-4-6' as ModelId, name: 'Claude Opus 4.6', icon: Gem, tier: 'premium', costPer1MTokens: 45, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Previous Opus, strong reasoning and planning' },
      { id: 'claude-sonnet-4-6' as ModelId, name: 'Claude Sonnet 4.6', icon: Sparkles, tier: 'balanced', costPer1MTokens: 9, capabilities: ['reasoning', 'code', 'vision', 'agentic'], description: 'Latest Sonnet — fast, capable, great for implementation' },
      { id: 'claude-haiku-4-5' as ModelId, name: 'Claude Haiku 4.5', icon: Zap, tier: 'fast', costPer1MTokens: 1, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fastest, ideal for simple tasks' },
    ],
  },
  openai: {
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.5-pro' as ModelId, name: 'GPT-5.5 Pro', icon: Gem, tier: 'premium', costPer1MTokens: 105, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Most advanced GPT-5.5 model. EXTREMELY expensive — only for hardest problems.' },
      { id: 'gpt-5.5' as ModelId, name: 'GPT-5.5', icon: Gem, tier: 'premium', costPer1MTokens: 17.5, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Latest OpenAI flagship (April 2026). Subscription auth only.' },
      { id: 'gpt-5.4-pro' as ModelId, name: 'GPT-5.4 Pro', icon: Gem, tier: 'premium', costPer1MTokens: 105, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'Most advanced GPT-5.4 model. Pro subscribers only.' },
      { id: 'gpt-5.4' as ModelId, name: 'GPT-5.4', icon: Sparkles, tier: 'balanced', costPer1MTokens: 8.75, capabilities: ['reasoning', 'code', 'vision', 'agentic', 'large-context'], description: 'OpenAI flagship. 1.05M context, strong coding.' },
      { id: 'gpt-5.4-mini' as ModelId, name: 'GPT-5.4 Mini', icon: FlaskConical, tier: 'fast', costPer1MTokens: 2.625, capabilities: ['fast', 'cost-efficient', 'code'], description: 'Fast and efficient. 400K context.' },
      { id: 'gpt-5.3-codex' as ModelId, name: 'GPT-5.3 Codex', icon: Sparkles, tier: 'balanced', costPer1MTokens: 7.875, capabilities: ['code', 'agentic', 'fast'], description: 'Industry-leading agentic coding model.' },
      { id: 'gpt-5.2' as ModelId, name: 'GPT-5.2', icon: FlaskConical, tier: 'balanced', costPer1MTokens: 5.625, capabilities: ['reasoning', 'code'], description: 'Previous-generation general-purpose model.' },
      { id: 'o3' as ModelId, name: 'O3', icon: Gem, tier: 'premium', costPer1MTokens: 5, capabilities: ['reasoning', 'code', 'agentic'], description: 'Deep reasoning. Best for debugging and complex analysis.' },
      { id: 'o4-mini' as ModelId, name: 'O4 Mini', icon: Sparkles, tier: 'balanced', costPer1MTokens: 10, capabilities: ['reasoning', 'code', 'fast'], description: 'Compact reasoning model.' },
      { id: 'gpt-4o' as ModelId, name: 'GPT-4o', icon: FlaskConical, tier: 'balanced', costPer1MTokens: 7.5, capabilities: ['reasoning', 'code', 'vision'], description: 'Versatile multimodal model' },
      { id: 'gpt-4o-mini' as ModelId, name: 'GPT-4o Mini', icon: Zap, tier: 'fast', costPer1MTokens: 0.6, capabilities: ['fast', 'cost-efficient'], description: 'Budget option for simple tasks' },
    ],
  },
  google: {
    name: 'Google',
    models: [
      { id: 'gemini-3.1-pro-preview' as ModelId, name: 'Gemini 3.1 Pro', icon: Layers, tier: 'premium', costPer1MTokens: 7, capabilities: ['reasoning', 'large-context', 'code'], description: 'Google flagship, 1M context, strong agentic coding' },
      { id: 'gemini-3.1-flash-lite-preview' as ModelId, name: 'Gemini 3.1 Flash Lite', icon: Zap, tier: 'fast', costPer1MTokens: 0.9, capabilities: ['fast', 'cost-efficient', 'large-context'], description: 'Most cost-efficient Google model' },
    ],
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    models: [
      { id: 'kimi-k2.6' as ModelId, name: 'Kimi K2.6', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi smartest model (April 2026). Native multimodal, superior agentic coding.' },
      { id: 'kimi-k2.5' as ModelId, name: 'Kimi K2.5', icon: Layers, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Best open-source coding, 256K context, 76.8% SWE-bench' },
      { id: 'K2.6-code-preview' as ModelId, name: 'K2.6-code-preview', icon: FlaskConical, tier: 'premium', costPer1MTokens: 1.6, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Kimi coding preview model.' },
    ],
  },
  zai: {
    name: 'Zhipu (GLM)',
    models: [
      { id: 'glm-5.1' as ModelId, name: 'GLM-5.1', icon: Network, tier: 'premium', costPer1MTokens: 2, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Z.AI flagship, 128K context, strong agentic coding' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    models: [
      { id: 'minimax-m2.7-highspeed' as ModelId, name: 'M2.7 Highspeed', icon: Zap, tier: 'premium', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 100 tps, 204K context, $0.06/M blended' },
      { id: 'minimax-m2.7' as ModelId, name: 'M2.7', icon: Layers, tier: 'balanced', costPer1MTokens: 1.5, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: '56.22% SWE-Pro, 10B active params, 204K context' },
    ],
  },
  mimo: {
    name: 'Xiaomi MiMo',
    models: [
      { id: 'mimo-v2.5-pro' as ModelId, name: 'MiMo V2.5 Pro', icon: Layers, tier: 'premium', costPer1MTokens: 2, capabilities: ['reasoning', 'code', 'agentic', 'large-context'], description: 'Flagship reasoning model, 1M context, enhanced agent efficiency' },
      { id: 'mimo-v2.5' as ModelId, name: 'MiMo V2.5', icon: Zap, tier: 'balanced', costPer1MTokens: 1, capabilities: ['code', 'agentic', 'fast'], description: 'Multimodal model, 262K context, strong agentic coding' },
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
  'planning-agent': ['reasoning'],
  'status-review': ['reasoning'],
  'review:security': ['reasoning', 'code'],
  'review:performance': ['reasoning', 'code'],
  'review:correctness': ['reasoning', 'code'],
  'review:requirements': ['reasoning', 'code'],
  'review:synthesis': ['reasoning'],
  'subagent:explore': ['fast', 'reasoning'],
  'subagent:plan': ['reasoning'],
  'subagent:bash': ['fast', 'code'],
  'subagent:general-purpose': ['reasoning', 'code'],
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
  'planning-agent': 'Planning Agent',
  'status-review': 'Status Review',
  'review:security': 'Security Reviewer',
  'review:performance': 'Performance Reviewer',
  'review:correctness': 'Correctness Reviewer',
  'review:requirements': 'Requirements Reviewer',
  'review:synthesis': 'Synthesis Agent',
  'subagent:explore': 'Explore Subagent',
  'subagent:plan': 'Plan Subagent',
  'subagent:bash': 'Bash Subagent',
  'subagent:general-purpose': 'General Purpose Subagent',
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

export function getModelById(id: ModelId): ModelDef | undefined {
  const models = getAllModels();
  return models.find(m => m.id === id);
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
  currentHarness?: Harness;
  isOverride: boolean;
  enabledProviders: string[];
  openRouterFavorites?: OpenRouterFavoriteModel[];
  onApply: (model: ModelId, harness?: Harness) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ModelOverrideModal({
  workType,
  currentModel,
  currentHarness = 'claude-code',
  isOverride,
  enabledProviders,
  openRouterFavorites,
  onApply,
  onRemove,
  onClose,
}: ModelOverrideModalProps) {
  const [selectedModel, setSelectedModel] = useState<ModelId>(currentModel);
  const [selectedHarness, setSelectedHarness] = useState<Harness>(currentHarness);
  const [harnessPolicy, setHarnessPolicy] = useState<HarnessPolicyDecisions>({});
  const [openRouterModels, setOpenRouterModels] = useState<ModelDef[]>([]);

  const workTypeName = WORK_TYPE_NAMES[workType] || workType;
  const requiredCapabilities = WORK_TYPE_CAPABILITIES[workType] || ['reasoning'];

  // Fetch OpenRouter favorites when provider is enabled
  useEffect(() => {
    if (!enabledProviders.includes('openrouter')) return;
    fetch('/api/settings/openrouter/models')
      .then(r => r.json())
      .then(({ models, favorites }: { models: { id: string; name: string }[]; favorites: string[] }) => {
        const favSet = new Set(favorites);
        const favModels: ModelDef[] = models
          .filter(m => favSet.has(m.id))
          .map(m => ({
            id: m.id as ModelId,
            name: m.name,
            icon: Globe,
            tier: 'balanced' as const,
            capabilities: ['reasoning', 'code'] as Capability[],
            description: `OpenRouter: ${m.id}`,
          }));
        setOpenRouterModels(favModels);
      })
      .catch(() => {});
  }, [enabledProviders]);

  // Filter providers based on enabled list, injecting OpenRouter favorites dynamically
  const availableProviders = useMemo(() => {
    const base = Object.entries(MODELS_BY_PROVIDER).filter(([key]) =>
      key === 'anthropic' || enabledProviders.includes(key)
    );
    if (enabledProviders.includes('openrouter') && openRouterModels.length > 0) {
      base.push(['openrouter', { name: 'OpenRouter (Favorites)', models: openRouterModels }]);
    }
    return base;
  }, [enabledProviders, openRouterModels]);

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

  useEffect(() => {
    let canceled = false;
    const modelIds = displayProviders.flatMap((provider) => provider.models.map((model) => model.id));
    if (modelIds.length === 0) return undefined;

    void fetch(`/api/settings/harness-policy?models=${encodeURIComponent(modelIds.join(','))}`)
      .then((r) => r.json())
      .then((data: { decisions?: HarnessPolicyDecisions }) => {
        if (!canceled) setHarnessPolicy(data.decisions ?? {});
      })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, [displayProviders]);

  const handleApply = () => {
    onApply(selectedModel, effectiveHarness);
    onClose();
  };

  const pickerGroups: ModelGroup[] = displayProviders.map((provider) => ({
    provider: provider.key,
    label: provider.name,
    models: provider.models.map((model) => ({
      id: model.id,
      label: model.name,
      provider: provider.key,
      costPer1MTokens: model.costPer1MTokens,
    })),
  }));
  const selectedHarnessDecision = canUsePickerHarness(selectedHarness, selectedModel, harnessPolicy);
  const effectiveHarness = selectedHarnessDecision.allowed ? selectedHarness : 'claude-code';
  const hasChanges = selectedModel !== currentModel || effectiveHarness !== currentHarness;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-[680px] bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-6 border-b border-border">
          <div className="flex justify-between items-start gap-3">
            <div className="flex flex-col gap-2">
              <h1 className="text-foreground tracking-tight text-2xl font-bold">Select Model</h1>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground text-sm">Task:</span>
                <span className="text-primary font-medium">{workTypeName}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-muted-foreground text-xs">Needs:</span>
                {requiredCapabilities.map(cap => (
                  <span key={cap} className="text-[10px] px-2 py-0.5 rounded badge-bg-primary text-primary font-medium">
                    {CAPABILITY_INFO[cap].name}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar max-h-[450px]">
          {displayProviders.map((provider, providerIndex) => (
            <div key={provider.key} className="flex flex-col">
              {providerIndex > 0 && <div className="h-px bg-divider mx-6 my-2" />}
              <h3 className="text-muted-foreground text-xs font-bold uppercase tracking-widest px-6 pb-2 pt-5">
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
                        ? 'badge-bg-primary border-primary shadow-[0_0_15px_var(--primary)]'
                        : isRecommended
                          ? 'badge-bg-primary border-primary/50 hover:bg-primary/10'
                          : 'border-transparent hover:bg-popover'
                    }`}
                  >
                    <div className={`flex items-center justify-center rounded-lg shrink-0 size-10 transition-colors ${
                      isSelected || isRecommended ? 'badge-bg-primary' : 'bg-card group-hover:bg-divider'
                    }`}>
                      <model.icon className={`w-5 h-5 ${isSelected || isRecommended ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>

                    <div className="flex flex-1 flex-col justify-center min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-foreground text-sm ${isSelected ? 'font-bold' : 'font-medium'} truncate`}>
                          {model.name}
                        </p>
                        {(() => {
                          const lvl = costWarningLevel(model.costPer1MTokens);
                          return lvl ? <CostWarningBadge level={lvl} costPer1MTokens={model.costPer1MTokens} /> : null;
                        })()}
                        {isFavorite && !isRecommended && (
                          <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-[9px] text-amber-400 font-bold uppercase tracking-tight shrink-0">
                            <Star className="w-2.5 h-2.5 fill-amber-400" />
                            Favorite
                          </span>
                        )}
                        {isRecommended && (
                          <span className="px-2 py-0.5 rounded-full bg-primary text-[9px] text-primary-foreground font-bold uppercase tracking-tight shrink-0">
                            Best Fit
                          </span>
                        )}
                        {model.tier === 'premium' && !isRecommended && (
                          <span className="px-2 py-0.5 rounded-full badge-bg-warning text-[9px] text-warning font-bold uppercase tracking-tight shrink-0">
                            Premium
                          </span>
                        )}
                        {model.tier === 'fast' && (
                          <span className="px-2 py-0.5 rounded-full badge-bg-success text-[9px] text-success font-bold uppercase tracking-tight shrink-0">
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
                                  ? 'badge-bg-primary text-primary'
                                  : 'bg-card text-muted-foreground border border-border'
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
                        <span className="text-success text-xs font-bold">100%</span>
                      ) : matchScore >= 0.5 ? (
                        <span className="text-warning text-xs font-bold">{Math.round(matchScore * 100)}%</span>
                      ) : (
                        <span className="text-muted-foreground text-xs font-bold">{Math.round(matchScore * 100)}%</span>
                      )}
                      {isSelected && (
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Harness strip — pick model first, then adjust harness */}
        <div className="px-6 py-3 border-t border-border bg-card">
          <HarnessSelect
            value={effectiveHarness}
            onChange={setSelectedHarness}
            modelId={selectedModel}
            groups={pickerGroups}
            harnessPolicy={harnessPolicy}
          />
          {!selectedHarnessDecision.allowed && (
            <p className="text-xs text-warning mt-1">{selectedHarnessDecision.reason ?? 'Pi is unavailable for this model/auth combination; Claude Code will be used.'}</p>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-border bg-card flex justify-between items-center">
          <div>
            {isOverride && (
              <button
                onClick={() => { onRemove(); onClose(); }}
                className="text-destructive hover:text-destructive/80 text-sm font-medium transition-colors"
              >
                Remove Override
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-muted-foreground font-medium hover:text-foreground hover:bg-popover transition-all text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges && isOverride}
              className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
