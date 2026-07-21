import { type VoiceHardwareSettings, type VoiceSettings } from './types';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stt: {
    provider: 'moonshine',
    moonshine: { model: 'base' },
    googleCloud: { apiKey: '', model: 'latest_long' },
  },
  autopreso: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
};

export const DEFAULT_VOICE_HARDWARE_SETTINGS: VoiceHardwareSettings = {
  inputDevice: '',
  outputDevice: '',
  volume: 1,
};

export const VOICE_HARDWARE_STORAGE_KEY = 'overdeck.voice.hardwareSettings';

export function loadVoiceHardwareSettings(): VoiceHardwareSettings {
  try {
    const raw = window.localStorage.getItem(VOICE_HARDWARE_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_HARDWARE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<VoiceHardwareSettings>;
    return {
      inputDevice: typeof parsed.inputDevice === 'string' ? parsed.inputDevice : '',
      outputDevice: typeof parsed.outputDevice === 'string' ? parsed.outputDevice : '',
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 1,
    };
  } catch {
    return DEFAULT_VOICE_HARDWARE_SETTINGS;
  }
}

export function normalizeVoiceSettings(settings: Partial<VoiceSettings>): VoiceSettings {
  return {
    stt: settings.stt ?? DEFAULT_VOICE_SETTINGS.stt,
    autopreso: settings.autopreso ?? DEFAULT_VOICE_SETTINGS.autopreso,
  };
}
