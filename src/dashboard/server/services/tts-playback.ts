import { loadConfig } from '../../../lib/config-yaml.js';
import { resolveAndSpeak } from '../../../lib/tts-speak.js';
import { initEventStore, type StoredEvent } from '../event-store.js';

interface TtsPlaybackState {
  unsubscribe: (() => void) | null;
  startPromise: Promise<void> | null;
}

interface ActivityTtsPayload {
  utterance?: unknown;
  priority?: unknown;
  issueId?: unknown;
  source?: unknown;
  eventType?: unknown;
}

const state: TtsPlaybackState = {
  unsubscribe: null,
  startPromise: null,
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function speakActivityTts(event: StoredEvent): Promise<void> {
  const payload = event.payload as ActivityTtsPayload;
  if (typeof payload.utterance !== 'string' || payload.utterance.trim().length === 0) return;

  try {
    const result = await resolveAndSpeak({
      text: payload.utterance,
      source: optionalString(payload.source),
      eventType: optionalString(payload.eventType),
      issueId: optionalString(payload.issueId),
      priority: typeof payload.priority === 'number' ? payload.priority : undefined,
    });

    if (result === 'daemon-unavailable') {
      console.warn('[tts-playback] TTS daemon unavailable');
    }
  } catch (error) {
    console.warn('[tts-playback] Playback failed', error);
  }
}

function onEvent(event: StoredEvent): void {
  if (event.type !== 'activity.tts') return;
  void speakActivityTts(event);
}

export async function startTtsPlayback(): Promise<void> {
  if (state.unsubscribe) return;
  if (state.startPromise) return state.startPromise;

  const { config } = loadConfig();
  if (!config.tts.enabled) {
    console.log('[tts-playback] Disabled (tts.enabled=false)');
    return;
  }

  state.startPromise = (async () => {
    const store = await initEventStore();
    if (state.unsubscribe) return;
    state.unsubscribe = store.subscribe(onEvent);
    console.log('[tts-playback] Started');
  })();

  try {
    await state.startPromise;
  } finally {
    state.startPromise = null;
  }
}

export function stopTtsPlayback(): void {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
}
