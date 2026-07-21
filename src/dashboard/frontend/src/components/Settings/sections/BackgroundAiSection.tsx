import { type ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import {
  BACKGROUND_AI_FEATURE_META,
  type BackgroundAiConfig,
  type BackgroundAiFeature,
  type ModelId,
  type SettingsConfig,
} from '../types';
import { EMBEDDING_MODELS_BY_PROVIDER } from '../embeddingModels';
import { BG_FEATURE_COST_SOURCE } from '../settingsPageConstants';

interface BackgroundAiSectionProps {
  backgroundCost?: {
    bySource?: Record<string, number>;
  };
  chatModelOptionEls: ReactNode;
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig, opts?: { debounce?: boolean }) => void;
}

export function BackgroundAiSection({
  backgroundCost,
  chatModelOptionEls,
  formData,
  onSettingsChange,
}: BackgroundAiSectionProps) {
  // Background AI toggles persist immediately (one-click low-cost mode).
  const updateBackgroundAi = (patch: BackgroundAiConfig) => {
    onSettingsChange({
      ...formData,
      background_ai: {
        cheap_mode: patch.cheap_mode ?? formData.background_ai?.cheap_mode ?? false,
        features: {
          ...formData.background_ai?.features,
          ...patch.features,
        },
      },
    });
  };

  // Apply an arbitrary settings patch and persist (used by the per-feature
  // model pickers in the Background AI section — PAN-1589).
  const applyBackgroundModelPatch = (next: SettingsConfig, opts: { debounce?: boolean } = {}) => {
    onSettingsChange(next, opts);
  };

  const bgSelectClass = 'bg-background border border-border rounded-md px-2 py-1 text-[11px] text-foreground focus:ring-1 focus:ring-primary';

  // Render the model control for one background feature. Heterogeneous: chat
  // features use the chat-model select; memory uses provider+model; embeddings
  // use a dedicated provider+embedding-model picker; TTS edits its own model.
  const backgroundModelControl = (key: BackgroundAiFeature) => {
    const setConv = (patch: NonNullable<SettingsConfig['conversations']>) =>
      applyBackgroundModelPatch({ ...formData, conversations: { ...formData.conversations, ...patch } });
    switch (key) {
      case 'conversationTitles':
      case 'titleRefinement':
        return (
          <select value={formData.conversations?.title_model || 'claude-haiku-4-5'}
            onChange={(e) => setConv({ title_model: e.target.value as ModelId })} className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      case 'summaryFork':
        return (
          <select value={formData.conversations?.compaction_model || 'claude-haiku-4-5'}
            onChange={(e) => setConv({ compaction_model: e.target.value as ModelId })} className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      case 'conversationEnrichment':
        return (
          <select value={formData.conversations?.enrichment?.quick_model || ''}
            onChange={(e) => setConv({ enrichment: { ...formData.conversations?.enrichment, quick_model: e.target.value || null } })}
            className={`${bgSelectClass} max-w-[180px]`}>
            <option value="">Auto (tier default)</option>
            {chatModelOptionEls}
          </select>
        );
      case 'memoryExtraction':
      case 'memoryQueryExpansion': {
        const provider = formData.memory?.provider || 'anthropic';
        const setMem = (patch: NonNullable<SettingsConfig['memory']>, opts: { debounce?: boolean } = {}) =>
          applyBackgroundModelPatch({ ...formData, memory: { ...formData.memory, ...patch } }, opts);
        return (
          <div className="flex items-center gap-1">
            <select value={provider} onChange={(e) => setMem({ provider: e.target.value as 'anthropic' | 'cliproxy' })} className={`${bgSelectClass} max-w-[110px]`}>
              <option value="anthropic">Anthropic</option>
              <option value="cliproxy">cliproxy</option>
            </select>
            <input type="text" value={formData.memory?.model || ''}
              onChange={(e) => setMem({ model: e.target.value || undefined }, { debounce: true })}
              placeholder={provider === 'cliproxy' ? 'gpt-4.1-nano' : 'claude-haiku-4-5-20251001'}
              className="w-36 bg-background border border-border rounded-md px-2 py-1 text-[11px] font-mono text-foreground focus:ring-1 focus:ring-primary" />
          </div>
        );
      }
      case 'sessionEmbeddings': {
        const provider = formData.conversations?.embedding_provider || 'openai';
        const models = EMBEDDING_MODELS_BY_PROVIDER[provider] ?? [];
        const model = formData.conversations?.embedding_model || models[0]?.id || '';
        return (
          <div className="flex items-center gap-1">
            <select value={provider}
              onChange={(e) => { const p = e.target.value as 'openai' | 'voyage' | 'ollama'; setConv({ embedding_provider: p, embedding_model: EMBEDDING_MODELS_BY_PROVIDER[p]?.[0]?.id }); }}
              className={`${bgSelectClass} max-w-[100px]`}>
              <option value="openai">OpenAI</option>
              <option value="voyage">Voyage</option>
              <option value="ollama">Ollama</option>
            </select>
            <select value={model} onChange={(e) => setConv({ embedding_model: e.target.value })} className={`${bgSelectClass} max-w-[170px]`}>
              {models.map((m) => <option key={m.id} value={m.id} title={m.description}>{m.label}</option>)}
            </select>
          </div>
        );
      }
      case 'ttsSummarizer':
        return (
          <select value={formData.tts_summarizer?.model || 'gpt-5.4-mini'}
            onChange={(e) => applyBackgroundModelPatch({ ...formData, tts_summarizer: { ...formData.tts_summarizer, model: e.target.value as ModelId } })}
            className={`${bgSelectClass} max-w-[180px]`}>
            {chatModelOptionEls}
          </select>
        );
      default:
        return null;
    }
  };

  return (
    <section id="background-ai" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-muted-foreground" />
        Background AI
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Automatic, behind-the-scenes model calls Overdeck makes on your behalf — conversation
        titles, memory extraction, enrichment, narration. Token spend for these is recorded in the
        cost ledger under <code className="font-mono">background:&lt;feature&gt;</code>.
      </p>
      <div className="space-y-1">
        {/* Low-cost master switch */}
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-muted/30 border border-border">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Low-cost mode</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              One-click switch that turns off every background AI feature below. Individual toggles
              resume when this is off.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={formData.background_ai?.cheap_mode ?? false}
            aria-label="Toggle low-cost mode"
            onClick={() => updateBackgroundAi({ cheap_mode: !(formData.background_ai?.cheap_mode ?? false) })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              (formData.background_ai?.cheap_mode ?? false) ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              (formData.background_ai?.cheap_mode ?? false) ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        {BACKGROUND_AI_FEATURE_META.map((feature) => {
          const cheapMode = formData.background_ai?.cheap_mode ?? false;
          const featureOn = formData.background_ai?.features?.[feature.key] ?? true;
          const effectiveOn = !cheapMode && featureOn;
          const cost24h = backgroundCost?.bySource?.[BG_FEATURE_COST_SOURCE[feature.key]];
          return (
            <div
              key={feature.key}
              className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg transition-colors hover:bg-muted/30"
            >
              <div className="min-w-0">
                <span className={`text-sm font-medium ${effectiveOn ? 'text-foreground' : 'text-muted-foreground'}`}>{feature.label}</span>
                {!effectiveOn && (
                  <span
                    className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                    title="This feature is off, so it isn't running — but you can still change its model below; the new model takes effect when you enable it (or turn off low-cost mode)."
                  >
                    not active
                  </span>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">{feature.description}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {backgroundModelControl(feature.key)}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className="font-mono tabular-nums text-[11px] text-muted-foreground w-16 text-right"
                  title="Spend over the last 24 hours"
                >
                  {typeof cost24h === 'number' ? `$${cost24h.toFixed(2)}` : '—'}
                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground/60">24h</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={effectiveOn}
                  aria-label={`Toggle ${feature.label}`}
                  disabled={cheapMode}
                  onClick={() => updateBackgroundAi({ features: { [feature.key]: !featureOn } })}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed ${
                    effectiveOn ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    effectiveOn ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground mt-3 px-4">
        You can change any feature's model even while it's off (e.g. to pick a cheaper one) — the
        choice is saved and takes effect when the feature runs, but a model shown under a
        <span className="mx-1 rounded bg-muted px-1 py-0.5 font-medium">not active</span>
        feature isn't being used yet. 24h figures are actual recorded spend. Models shared between
        rows (titles + refinement, memory extraction + query expansion) edit the same setting.
      </p>
    </section>
  );
}
