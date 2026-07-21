import type { SettingsConfig } from '../Settings/types';

const SETTINGS_STORAGE_KEY = 'pan-settings-cache';
export const FALLBACK_DEFAULT_CONVERSATION_MODEL = '';

let defaultConversationModel = FALLBACK_DEFAULT_CONVERSATION_MODEL;
let settingsRequest: Promise<void> | null = null;

export function applyDefaultConversationModel(modelId: string | null | undefined): void {
  defaultConversationModel = modelId || FALLBACK_DEFAULT_CONVERSATION_MODEL;
}

export function getDefaultConversationModel(): string {
  return defaultConversationModel;
}

function readCachedSettings(): Partial<SettingsConfig> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SettingsConfig>;
  } catch {
    return null;
  }
}

export async function ensureDefaultConversationModel(): Promise<void> {
  if (!settingsRequest) {
    settingsRequest = (async () => {
      const cached = readCachedSettings();
      applyDefaultConversationModel(cached?.models?.default_conversation_model);

      try {
        const settings = await fetch('/api/settings').then((res) => res.json()) as SettingsConfig;
        applyDefaultConversationModel(settings.models.default_conversation_model);
      } catch {
        // Keep cached or fallback default
      }
    })();
  }

  return settingsRequest;
}
