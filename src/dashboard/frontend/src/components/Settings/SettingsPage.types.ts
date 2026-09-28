// OpenRouter types matching OpenRouterModelBrowser
export interface OpenRouterModelCatalog {
  id: string;
  name: string;
  promptCostPer1M: number | null;
  completionCostPer1M: number | null;
  contextLength: number | null;
  supportsThinking: boolean;
  category: 'free' | 'chat' | 'code' | 'other';
  topProvider?: string;
}

export interface OpenRouterCatalogResponse {
  models: OpenRouterModelCatalog[];
  favorites: string[];
}

export interface SaveSettingsResponse {
  success: boolean;
  message: string;
  warnings?: string[];
}

export interface CloisterConfig {
  concurrency?: {
    max_work_agents?: number;
    reserved_advancing_slots?: number;
    exempt_operator_started?: boolean;
  };
  [key: string]: unknown;
}

/** Mirrors src/lib/cloister/close-out-settings.ts's CloseOutSettingsView (PAN-4283). */
export type CloseOutSource = 'default' | 'cloister.toml';

export interface CloseOutSettingView<T> {
  value: T;
  source: CloseOutSource;
  inert?: true;
}

export interface CloseOutSettingsView {
  remove_workspace: CloseOutSettingView<boolean>;
  delete_feature_branch: CloseOutSettingView<boolean>;
  auto: CloseOutSettingView<boolean>;
  auto_delay_minutes: CloseOutSettingView<number>;
}
