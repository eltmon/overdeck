import { createGoogleCloudTranscription } from './google-cloud-transcription.js';
import { createMoonshineTranscription, type ITurnEmitter } from './transcription.js';

export interface VoiceSettings {
  stt: {
    provider: 'moonshine' | 'google-cloud';
    moonshine: { model: string };
    googleCloud: { apiKey: string; model: string };
  };
}

export interface TranscriptionManager {
  applyCurrent(): void;
  getActive(): ITurnEmitter | null;
  close(): void;
}

export function createTranscriptionManager(settings: VoiceSettings): TranscriptionManager {
  let active: ITurnEmitter | null = null;

  const createActive = (): ITurnEmitter => {
    if (settings.stt.provider === 'moonshine') {
      return createMoonshineTranscription(settings.stt.moonshine.model);
    }
    return createGoogleCloudTranscription(
      settings.stt.googleCloud.apiKey,
      settings.stt.googleCloud.model
    );
  };

  return {
    applyCurrent() {
      active?.close();
      active = createActive();
    },
    getActive() {
      return active;
    },
    close() {
      active?.close();
      active = null;
    },
  };
}
