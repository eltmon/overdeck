import { resolveAndSpeak } from '../../../lib/tts-speak.js';
import { initEventStore, type StoredEvent } from '../event-store.js';
import { getTtsRuntimeConfig } from './tts-runtime-config.js';

const MAX_TTS_QUEUE_LENGTH = 20;

interface TtsPlaybackState {
  unsubscribe: (() => void) | null;
  startPromise: Promise<void> | null;
  queue: StoredEvent[];
  processing: boolean;
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
  queue: [],
  processing: false,
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function eventPriority(event: StoredEvent): number | undefined {
  const payload = event.payload as ActivityTtsPayload;
  return typeof payload.priority === 'number' ? payload.priority : undefined;
}

function dropIndexForFullQueue(queue: StoredEvent[], incomingPriority: number): number | undefined {
  const infoIndex = queue.findIndex((event) => (eventPriority(event) ?? 1) >= 2);
  if (infoIndex >= 0) return infoIndex;

  let candidateIndex = 0;
  let candidatePriority = eventPriority(queue[0]!) ?? 1;
  for (let index = 1; index < queue.length; index += 1) {
    const priority = eventPriority(queue[index]!) ?? 1;
    if (priority > candidatePriority) {
      candidateIndex = index;
      candidatePriority = priority;
    }
  }

  return incomingPriority < candidatePriority ? candidateIndex : undefined;
}

async function speakActivityTts(event: StoredEvent): Promise<void> {
  const config = getTtsRuntimeConfig();
  if (!config.enabled) return;

  const payload = event.payload as ActivityTtsPayload;
  if (typeof payload.utterance !== 'string' || payload.utterance.trim().length === 0) return;

  try {
    const result = await resolveAndSpeak({
      text: payload.utterance,
      source: optionalString(payload.source),
      eventType: optionalString(payload.eventType),
      issueId: optionalString(payload.issueId),
      priority: typeof payload.priority === 'number' ? payload.priority : undefined,
    }, { config });

    if (result === 'daemon-unavailable') {
      console.warn('[tts-playback] TTS daemon unavailable');
    }
  } catch (error) {
    console.warn('[tts-playback] Playback failed', error);
  }
}

async function drainQueue(): Promise<void> {
  if (state.processing) return;
  state.processing = true;

  try {
    while (state.queue.length > 0 && getTtsRuntimeConfig().enabled) {
      const event = state.queue.shift();
      if (event) await speakActivityTts(event);
    }

    if (!getTtsRuntimeConfig().enabled) {
      state.queue = [];
    }
  } finally {
    state.processing = false;
  }
}

function enqueueActivityTts(event: StoredEvent): void {
  const config = getTtsRuntimeConfig();
  if (!config.enabled) return;

  if (state.queue.length >= MAX_TTS_QUEUE_LENGTH) {
    const priority = eventPriority(event) ?? 1;
    if (config.dropInfoWhenFull && priority >= 2) return;
    const dropIndex = config.dropInfoWhenFull ? dropIndexForFullQueue(state.queue, priority) : 0;
    if (dropIndex === undefined) return;
    state.queue.splice(dropIndex, 1);
  }

  state.queue.push(event);
  void drainQueue();
}

function onEvent(event: StoredEvent): void {
  if (event.type !== 'activity.tts') return;
  enqueueActivityTts(event);
}

export async function startTtsPlayback(): Promise<void> {
  if (state.unsubscribe) return;
  if (state.startPromise) return state.startPromise;

  if (!getTtsRuntimeConfig().enabled) {
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
  state.queue = [];
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
}

export async function syncTtsPlaybackWithConfig(): Promise<void> {
  if (getTtsRuntimeConfig().enabled) {
    await startTtsPlayback();
  } else {
    stopTtsPlayback();
  }
}
