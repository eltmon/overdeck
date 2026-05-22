import { Effect } from 'effect';
import type { NormalizedTtsDaemonConfig } from './config-yaml.js';
import { getTtsDaemonAuthHeaders } from './tts-daemon.js';
import { findVoiceById, type TtsVoice } from './tts-voices.js';
import { TrackerError } from './errors.js';

export type TtsSpeakMode = 'custom' | 'design' | 'clone';
export type TtsSpeakResult = 'spoken' | 'muted' | 'daemon-unavailable' | 'no-voice';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResolveAndSpeakOptions {
  text: string;
  source?: string;
  eventType?: string;
  issueId?: string;
  priority?: number;
  voiceId?: string;
  preview?: boolean;
  voice?: string;
  instruct?: string;
  volume?: number;
  mode?: TtsSpeakMode;
  embedding?: number[];
}

export interface TtsSpeakPayload {
  text: string;
  voice: string;
  instruct: string;
  volume: number;
  rate: number;
  maxChars: number;
  dropInfoWhenFull: boolean;
  mode: TtsSpeakMode;
  embedding?: number[];
}

type PromiseOrEffect<T> = Promise<T> | Effect.Effect<T, unknown, never>;

async function runPromiseOrEffect<T>(value: PromiseOrEffect<T>): Promise<T> {
  return typeof (value as { pipe?: unknown }).pipe === 'function'
    ? Effect.runPromise(value as Effect.Effect<T, unknown, never>)
    : value as Promise<T>;
}

export interface ResolveAndSpeakDeps {
  config: NormalizedTtsDaemonConfig;
  findVoiceById?: (id: string) => PromiseOrEffect<TtsVoice | undefined>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function renderTemplate(template: string, issueId: string | undefined): string {
  return template.replaceAll('{issueId}', issueId ?? '');
}

function truncateForTts(text: string, config: NormalizedTtsDaemonConfig): string {
  return text.length > config.maxChars ? text.slice(0, config.maxChars) : text;
}

function ttsPayloadControls(config: NormalizedTtsDaemonConfig): Pick<TtsSpeakPayload, 'rate' | 'maxChars' | 'dropInfoWhenFull'> {
  return {
    rate: config.rate,
    maxChars: config.maxChars,
    dropInfoWhenFull: config.dropInfoWhenFull,
  };
}

function resolveVoiceId(options: ResolveAndSpeakOptions, config: NormalizedTtsDaemonConfig): string {
  if (options.voiceId) return options.voiceId;
  if (options.eventType && config.voiceMap[options.eventType]) return config.voiceMap[options.eventType];
  if (options.priority === 2) return config.statusVoice || config.voice;
  return config.voice;
}

export function buildTtsSpeakPayloadSync(
  voice: TtsVoice,
  text: string,
  config: NormalizedTtsDaemonConfig,
): TtsSpeakPayload {
  if (voice.kind === 'design') {
    return {
      text,
      voice: voice.description || voice.name,
      instruct: voice.instruct || '',
      volume: config.volume,
      ...ttsPayloadControls(config),
      mode: 'design',
    };
  }

  if (voice.kind === 'clone') {
    return {
      text,
      voice: 'clone',
      instruct: voice.instruct || '',
      volume: config.volume,
      ...ttsPayloadControls(config),
      mode: 'clone',
      embedding: voice.embedding,
    };
  }

  return {
    text,
    voice: voice.presetName || voice.name,
    instruct: voice.instruct || '',
    volume: config.volume,
    ...ttsPayloadControls(config),
    mode: 'custom',
  };
}

function buildDirectTtsSpeakPayload(
  options: ResolveAndSpeakOptions,
  text: string,
  config: NormalizedTtsDaemonConfig,
): TtsSpeakPayload | undefined {
  if (!options.voice) return undefined;
  return {
    text,
    voice: options.voice,
    instruct: options.instruct || '',
    volume: options.volume ?? config.volume,
    ...ttsPayloadControls(config),
    mode: options.mode || 'custom',
    embedding: options.embedding,
  };
}

async function postSpeakPayload(
  payload: TtsSpeakPayload,
  config: NormalizedTtsDaemonConfig,
  deps: Pick<ResolveAndSpeakDeps, 'fetch' | 'timeoutMs'>,
): Promise<TtsSpeakResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5_000);

  try {
    const response = await (deps.fetch ?? fetch)(`http://${config.daemonHost}:${config.daemonPort}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await Effect.runPromise(getTtsDaemonAuthHeaders()) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.ok ? 'spoken' : 'daemon-unavailable';
  } catch {
    return 'daemon-unavailable';
  } finally {
    clearTimeout(timeout);
  }
}async function resolveAndSpeakPromise(
  options: ResolveAndSpeakOptions,
  deps: ResolveAndSpeakDeps,
): Promise<TtsSpeakResult> {
  const config = deps.config;

  const text = truncateForTts(
    options.eventType && config.utteranceTemplates[options.eventType]
      ? renderTemplate(config.utteranceTemplates[options.eventType], options.issueId)
      : options.text,
    config,
  );

  const directPayload = buildDirectTtsSpeakPayload(options, text, config);
  if (directPayload) return postSpeakPayload(directPayload, config, deps);

  const isSavedVoicePreview = options.preview === true && typeof options.voiceId === 'string';
  if (!isSavedVoicePreview) {
    if (!config.enabled) return 'muted';
    if (options.source && config.mutedSources.includes(options.source)) return 'muted';
    if (options.issueId && config.mutedIssues.includes(options.issueId)) return 'muted';
  }

  const voiceId = resolveVoiceId(options, config).trim();
  if (!voiceId) return 'no-voice';

  const voice = await runPromiseOrEffect((deps.findVoiceById ?? findVoiceById)(voiceId));
  if (!voice) return 'no-voice';

  return postSpeakPayload(buildTtsSpeakPayloadSync(voice, text, config), config, deps);
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Build a TTS speak payload from a voice + text. Pure. */
export const buildTtsSpeakPayload = (
  voice: TtsVoice,
  text: string,
  config: NormalizedTtsDaemonConfig,
): Effect.Effect<TtsSpeakPayload> =>
  Effect.sync(() => buildTtsSpeakPayloadSync(voice, text, config));

/**
 * Resolve a voice and post a speak request to the TTS daemon. Wraps the
 * Promise variant. Network failures collapse to `'daemon-unavailable'` in
 * the success channel; only synchronous mis-use surfaces as TrackerError.
 */
export const resolveAndSpeak = (
  options: ResolveAndSpeakOptions,
  deps: ResolveAndSpeakDeps,
): Effect.Effect<TtsSpeakResult, TrackerError> =>
  Effect.tryPromise({
    try: () => resolveAndSpeakPromise(options, deps),
    catch: (cause) =>
      new TrackerError({
        tracker: 'tts',
        operation: 'resolveAndSpeak',
        message: 'resolveAndSpeak failed',
        cause,
      }),
  });
