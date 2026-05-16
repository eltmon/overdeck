import { loadConfig, type NormalizedTtsDaemonConfig } from './config-yaml.js';
import { findVoiceById, type TtsVoice } from './tts-voices.js';

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
  voice?: string;
  instruct?: string;
  mode?: TtsSpeakMode;
  embedding?: number[];
}

export interface TtsSpeakPayload {
  text: string;
  voice: string;
  instruct: string;
  volume: number;
  mode: TtsSpeakMode;
  embedding?: number[];
}

export interface ResolveAndSpeakDeps {
  config?: NormalizedTtsDaemonConfig;
  findVoiceById?: (id: string) => Promise<TtsVoice | undefined>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

function renderTemplate(template: string, issueId: string | undefined): string {
  return template.replaceAll('{issueId}', issueId ?? '');
}

function resolveVoiceId(options: ResolveAndSpeakOptions, config: NormalizedTtsDaemonConfig): string {
  if (options.voiceId) return options.voiceId;
  if (options.eventType && config.voiceMap[options.eventType]) return config.voiceMap[options.eventType];
  if (options.priority === 2) return config.statusVoice || config.voice;
  return config.voice;
}

export function buildTtsSpeakPayload(
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
      mode: 'design',
    };
  }

  if (voice.kind === 'clone') {
    return {
      text,
      voice: 'clone',
      instruct: voice.instruct || '',
      volume: config.volume,
      mode: 'clone',
      embedding: voice.embedding,
    };
  }

  return {
    text,
    voice: voice.presetName || voice.name,
    instruct: voice.instruct || '',
    volume: config.volume,
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
    volume: config.volume,
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.ok ? 'spoken' : 'daemon-unavailable';
  } catch {
    return 'daemon-unavailable';
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAndSpeak(
  options: ResolveAndSpeakOptions,
  deps: ResolveAndSpeakDeps = {},
): Promise<TtsSpeakResult> {
  const config = deps.config ?? loadConfig().config.tts;

  if (options.source && config.mutedSources.includes(options.source)) return 'muted';
  if (options.issueId && config.mutedIssues.includes(options.issueId)) return 'muted';

  const text = options.eventType && config.utteranceTemplates[options.eventType]
    ? renderTemplate(config.utteranceTemplates[options.eventType], options.issueId)
    : options.text;

  const directPayload = buildDirectTtsSpeakPayload(options, text, config);
  if (directPayload) return postSpeakPayload(directPayload, config, deps);

  const voiceId = resolveVoiceId(options, config).trim();
  if (!voiceId) return 'no-voice';

  const voice = await (deps.findVoiceById ?? findVoiceById)(voiceId);
  if (!voice) return 'no-voice';

  return postSpeakPayload(buildTtsSpeakPayload(voice, text, config), config, deps);
}
