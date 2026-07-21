import { type SettingsConfig } from './types';

/** Pure merge: apply MiniMax model preset while preserving all non-model settings. */
export function buildMiniMaxFormData(
  formData: SettingsConfig | null,
  miniMaxDefaults: SettingsConfig,
): SettingsConfig {
  return {
    models: {
      providers: { ...miniMaxDefaults.models.providers },
      overrides: { ...miniMaxDefaults.models.overrides },
      gemini_thinking_level: formData?.models.gemini_thinking_level,
    },
    api_keys: { ...(formData?.api_keys || {}) },
    agents: { ...(formData?.agents || miniMaxDefaults.agents || {}) },
    tracker_keys: { ...(formData?.tracker_keys || {}) },
    conversationSearch: { ...(formData?.conversationSearch || miniMaxDefaults.conversationSearch || {}) },
    conversations: { ...(formData?.conversations || miniMaxDefaults.conversations || {}) },
    memory: { ...(formData?.memory || miniMaxDefaults.memory || {}) },
    tmux: { ...(formData?.tmux || miniMaxDefaults.tmux || {}) },
    openrouter: { ...(formData?.openrouter || miniMaxDefaults.openrouter || {}) },
    tts: { ...(formData?.tts || miniMaxDefaults.tts || {}) },
    remote: { ...(formData?.remote || miniMaxDefaults.remote || {}) },
  };
}
