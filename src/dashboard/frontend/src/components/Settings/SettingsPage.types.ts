// OpenRouter types matching OpenRouterModelBrowser
export interface OpenRouterModelCatalog {
  id: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number;
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
