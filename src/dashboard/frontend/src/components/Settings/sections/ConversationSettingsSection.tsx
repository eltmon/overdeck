import type { ReactNode } from 'react';
import { MODELS_BY_PROVIDER, type OpenRouterFavoriteModel } from '../modelCatalog';
import type { ModelId, SettingsConfig } from '../types';

interface ConversationSettingsSectionProps {
  children: ReactNode;
  formData: SettingsConfig;
  onSettingsChange: (next: SettingsConfig) => void;
  openRouterFavoriteModels: OpenRouterFavoriteModel[];
}

export function ConversationSettingsSection({
  children,
  formData,
  onSettingsChange,
  openRouterFavoriteModels,
}: ConversationSettingsSectionProps) {
  const handleCompactionModelChange = (modelId: ModelId) => {
    onSettingsChange({
      ...formData,
      conversations: {
        ...formData.conversations,
        compaction_model: modelId,
      },
    });
  };

  const handleTitleModelChange = (modelId: ModelId) => {
    onSettingsChange({
      ...formData,
      conversations: {
        ...formData.conversations,
        title_model: modelId,
      },
    });
  };

  const handleManualCompactModeChange = (mode: 'claude-code' | 'overdeck-native') => {
    onSettingsChange({
      ...formData,
      conversations: {
        ...formData.conversations,
        manual_compact_mode: mode,
      },
    });
  };

  const handleRichCompactionChange = (enabled: boolean) => {
    onSettingsChange({
      ...formData,
      conversations: {
        ...formData.conversations,
        rich_compaction: enabled,
      },
    });
  };

  return (
    <section id="conversations" className="py-6 scroll-mt-4">
      <h2 className="text-foreground text-base font-semibold tracking-tight mb-4">
        Conversations
      </h2>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Compaction model</span>
            <p className="text-xs text-muted-foreground mt-0.5">Used for native compaction and fork summaries</p>
          </div>
          <select
            value={formData.conversations?.compaction_model || 'claude-haiku-4-5'}
            onChange={(e) => handleCompactionModelChange(e.target.value as ModelId)}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            {Object.entries(MODELS_BY_PROVIDER).flatMap(([, providerDef]) =>
              providerDef.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {providerDef.name} — {model.name}
                </option>
              ))
            )}
            {openRouterFavoriteModels.map((model) => (
              <option key={model.id} value={model.id}>
                OpenRouter — {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Title generation model</span>
            <p className="text-xs text-muted-foreground mt-0.5">Generates conversation titles from first message</p>
          </div>
          <select
            value={formData.conversations?.title_model || 'claude-haiku-4-5'}
            onChange={(e) => handleTitleModelChange(e.target.value as ModelId)}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary max-w-[200px]"
          >
            {Object.entries(MODELS_BY_PROVIDER).flatMap(([, providerDef]) =>
              providerDef.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {providerDef.name} — {model.name}
                </option>
              ))
            )}
            {openRouterFavoriteModels.map((model) => (
              <option key={model.id} value={model.id}>
                OpenRouter — {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">/compact handling</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {(formData.conversations?.manual_compact_mode || 'claude-code') === 'claude-code'
                ? 'Pass through to Claude Code'
                : 'Overdeck-native compaction'}
            </p>
          </div>
          <select
            value={formData.conversations?.manual_compact_mode || 'claude-code'}
            onChange={(e) => handleManualCompactModeChange(e.target.value as 'claude-code' | 'overdeck-native')}
            className="bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-primary"
          >
            <option value="claude-code">Pass through</option>
            <option value="overdeck-native">Native compaction</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg hover:bg-muted/30 transition-colors">
          <div className="min-w-0">
            <span className="text-sm font-medium text-foreground">Rich summaries</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              9-section verbose format (higher token usage)
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!formData.conversations?.rich_compaction}
            aria-label="Toggle rich compaction summaries"
            onClick={() => handleRichCompactionChange(!formData.conversations?.rich_compaction)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
              formData.conversations?.rich_compaction ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              formData.conversations?.rich_compaction ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`} />
          </button>
        </div>

        {children}
      </div>
    </section>
  );
}
