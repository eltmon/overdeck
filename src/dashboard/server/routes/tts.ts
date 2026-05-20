import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { resolveAndSpeak, type ResolveAndSpeakOptions, type TtsSpeakMode, type TtsSpeakResult } from '../../../lib/tts-speak.js';
import { getTtsRuntimeConfig } from '../services/tts-runtime-config.js';
import { getHeaderFromMap, validateOrigin, type HeaderMap } from './origin-validation.js';
import {
  addVoice as addStoredVoice,
  clearVoices as clearStoredVoices,
  deleteVoice as deleteStoredVoice,
  loadVoices as loadStoredVoices,
  type TtsVoice,
} from '../../../lib/tts-voices.js';
import { jsonResponse } from '../http-helpers.js';
import { getTtsDaemonAuthHeaders, getTtsDaemonStatus, startTtsDaemon, type TtsDaemonStartResult, type TtsDaemonStatus } from '../../../lib/tts-daemon.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const EXTRACT_EMBEDDING_TIMEOUT_MS = 60_000;
export const TTS_ROUTE_BODY_MAX_BYTES = 64 * 1024;
export const TTS_SPEAK_TEXT_MAX_CHARS = 4_096;
export const TTS_EXTRACT_TEXT_MAX_CHARS = 2_000;
export const TTS_EXTRACT_DESIGN_MAX_CHARS = 2_000;
export const QWEN_TTS_SPEAKER_EMBEDDING_MAX_DIMS = 512;

export type TtsHealthResult = TtsDaemonStatus & { ttsEnabled: boolean };

export interface CheckTtsHealthOptions {
  fetch?: FetchLike;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export async function checkTtsHealth(options: CheckTtsHealthOptions = {}): Promise<TtsHealthResult> {
  const runtimeConfig = getTtsRuntimeConfig();
  const config = {
    ...runtimeConfig,
    daemonHost: options.host ?? runtimeConfig.daemonHost,
    daemonPort: options.port ?? runtimeConfig.daemonPort,
  };

  if (!options.fetch) {
    const status = await getTtsDaemonStatus(config);
    return { ...status, ttsEnabled: runtimeConfig.enabled };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);

  try {
    const response = await options.fetch(`http://${config.daemonHost}:${config.daemonPort}/health`, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, running: false, pid: null, phase: 'stopped', daemonHost: config.daemonHost, daemonPort: config.daemonPort, ttsEnabled: runtimeConfig.enabled, error: 'daemon unreachable' };
    }
    const body = await response.json() as { queue?: unknown; model?: unknown; pid?: unknown };
    const pid = typeof body.pid === 'number' && Number.isFinite(body.pid) && body.pid > 0 ? Math.floor(body.pid) : null;
    return {
      ok: true,
      running: true,
      pid,
      phase: 'healthy',
      daemonHost: config.daemonHost,
      daemonPort: config.daemonPort,
      ttsEnabled: runtimeConfig.enabled,
      queue: body.queue,
      queueDepth: typeof body.queue === 'number' ? body.queue : undefined,
      model: body.model,
    };
  } catch {
    return { ok: false, running: false, pid: null, phase: 'stopped', daemonHost: config.daemonHost, daemonPort: config.daemonPort, ttsEnabled: runtimeConfig.enabled, error: 'daemon unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

export type PublicTtsVoice = Omit<TtsVoice, 'embedding'>;
export type CreateTtsVoiceInput = Omit<TtsVoice, 'id' | 'createdAt'>;

export interface TtsVoiceStore {
  loadVoices?: () => Promise<TtsVoice[]>;
  addVoice?: (voice: CreateTtsVoiceInput) => Promise<TtsVoice>;
  deleteVoice?: (id: string) => Promise<boolean>;
  clearVoices?: () => Promise<number>;
}

export interface SpeakTtsResponse {
  status: number;
  body: {
    spoken: boolean;
    result: TtsSpeakResult;
    error?: string;
  };
}

export interface SpeakTtsDeps {
  resolveAndSpeak?: (input: ResolveAndSpeakOptions) => Promise<TtsSpeakResult>;
}

export interface ExtractEmbeddingInput {
  design: string;
  text: string;
}

export type ExtractEmbeddingResponse =
  | { status: 200; body: unknown }
  | { status: 503; body: { error: string } };

export interface ExtractEmbeddingDeps {
  fetch?: FetchLike;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

function isValidCloneEmbedding(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= QWEN_TTS_SPEAKER_EMBEDDING_MAX_DIMS
    && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isBoundedText(value: unknown, maxChars: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxChars;
}

function ttsPayloadTooLargeResponse(request: HttpServerRequest.HttpServerRequest): Response | undefined {
  const rawContentLength = getHeaderFromMap(request.headers as HeaderMap, 'content-length');
  if (!rawContentLength) return undefined;
  const contentLength = Number.parseInt(rawContentLength, 10);
  if (Number.isFinite(contentLength) && contentLength > TTS_ROUTE_BODY_MAX_BYTES) {
    return jsonResponse({ error: 'TTS request too large' }, { status: 413 });
  }
  return undefined;
}

export type CappedBodyReadResult =
  | { ok: true; text: string }
  | { ok: false; status: 413; error: string };

// Read the body via Effect's request.text (which works against both Node's
// IncomingMessage and Web Fetch Request). The old implementation reached for
// request.source.body.getReader() directly, which is undefined on Node and
// silently returned an empty body — every POST /api/tts/* request 400'd as
// "invalid speak request" in production. Tests passed because they passed a
// Fetch-style Request mock that does expose .body.
export const readCappedTtsBodyText = (
  request: HttpServerRequest.HttpServerRequest,
  maxBytes = TTS_ROUTE_BODY_MAX_BYTES,
): Effect.Effect<CappedBodyReadResult> =>
  Effect.gen(function* () {
    const text = yield* request.text;
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      return { ok: false, status: 413, error: 'TTS request too large' } as const;
    }
    return { ok: true, text } as const;
  }).pipe(
    Effect.catch(() => Effect.succeed({ ok: false, status: 413, error: 'TTS request too large' } as const)),
  );

export function toPublicVoice(voice: TtsVoice): PublicTtsVoice {
  const { embedding: _embedding, ...publicVoice } = voice;
  return publicVoice;
}

export async function listTtsVoices(store: TtsVoiceStore = {}): Promise<PublicTtsVoice[]> {
  const loadVoices = store.loadVoices ?? loadStoredVoices;
  const voices = await loadVoices();
  return voices.map(toPublicVoice);
}

export function parseCreateTtsVoiceInput(body: unknown): CreateTtsVoiceInput | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.trim().length === 0) return undefined;
  if (record.kind !== 'preset' && record.kind !== 'design' && record.kind !== 'clone') return undefined;

  const input: CreateTtsVoiceInput = {
    name: record.name,
    kind: record.kind,
  };

  if (record.presetName !== undefined) {
    if (typeof record.presetName !== 'string') return undefined;
    input.presetName = record.presetName;
  }
  if (record.description !== undefined) {
    if (typeof record.description !== 'string') return undefined;
    input.description = record.description;
  }
  if (record.instruct !== undefined) {
    if (typeof record.instruct !== 'string') return undefined;
    input.instruct = record.instruct;
  }
  if (record.embedding !== undefined) {
    if (!isValidCloneEmbedding(record.embedding)) return undefined;
    input.embedding = record.embedding;
  }

  if (input.kind === 'clone' && (!input.embedding || input.embedding.length === 0)) return undefined;

  return input;
}

function parseTtsSpeakMode(value: unknown): TtsSpeakMode | undefined {
  if (value === undefined) return undefined;
  return value === 'custom' || value === 'design' || value === 'clone' ? value : undefined;
}

export function parseSpeakTtsInput(body: unknown): ResolveAndSpeakOptions | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const record = body as Record<string, unknown>;
  if (!isBoundedText(record.text, TTS_SPEAK_TEXT_MAX_CHARS)) return undefined;

  const mode = parseTtsSpeakMode(record.mode);
  if (record.mode !== undefined && !mode) return undefined;

  const input: ResolveAndSpeakOptions = { text: record.text };
  if (typeof record.source === 'string') input.source = record.source;
  if (typeof record.eventType === 'string') input.eventType = record.eventType;
  if (typeof record.issueId === 'string') input.issueId = record.issueId;
  if (typeof record.priority === 'number') input.priority = record.priority;
  if (record.preview !== undefined) {
    if (typeof record.preview !== 'boolean') return undefined;
    input.preview = record.preview;
  }
  if (typeof record.voiceId === 'string') input.voiceId = record.voiceId;
  if (typeof record.voice === 'string') input.voice = record.voice;
  if (typeof record.instruct === 'string') input.instruct = record.instruct;
  if (record.volume !== undefined) {
    if (typeof record.volume !== 'number' || record.volume < 0 || record.volume > 1) return undefined;
    input.volume = record.volume;
  }
  if (mode) input.mode = mode;
  if (record.embedding !== undefined) {
    if (!isValidCloneEmbedding(record.embedding)) return undefined;
    input.embedding = record.embedding;
  }

  return input;
}

export function parseExtractEmbeddingInput(body: unknown): ExtractEmbeddingInput | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (!isBoundedText(record.design, TTS_EXTRACT_DESIGN_MAX_CHARS)) return undefined;
  if (!isBoundedText(record.text, TTS_EXTRACT_TEXT_MAX_CHARS)) return undefined;
  return { design: record.design, text: record.text };
}

export async function createTtsVoice(input: CreateTtsVoiceInput, store: TtsVoiceStore = {}): Promise<TtsVoice> {
  const addVoice = store.addVoice ?? addStoredVoice;
  return addVoice(input);
}

export async function removeTtsVoice(id: string, store: TtsVoiceStore = {}): Promise<boolean> {
  const deleteVoice = store.deleteVoice ?? deleteStoredVoice;
  return deleteVoice(id);
}

export async function clearTtsVoices(store: TtsVoiceStore = {}): Promise<number> {
  const clearVoices = store.clearVoices ?? clearStoredVoices;
  return clearVoices();
}

export async function speakTts(input: ResolveAndSpeakOptions, deps: SpeakTtsDeps = {}): Promise<SpeakTtsResponse> {
  const result = deps.resolveAndSpeak
    ? await deps.resolveAndSpeak(input)
    : await resolveAndSpeak(input, { config: getTtsRuntimeConfig() });
  if (result === 'daemon-unavailable') {
    return {
      status: 503,
      body: { spoken: false, result, error: 'TTS daemon unavailable' },
    };
  }

  return {
    status: 200,
    body: { spoken: result === 'spoken', result },
  };
}

export async function startTtsDaemonFromDashboard(): Promise<TtsDaemonStartResult> {
  return startTtsDaemon({ config: getTtsRuntimeConfig(), detach: true, timeoutMs: 120_000 });
}

export async function extractTtsEmbedding(
  input: ExtractEmbeddingInput,
  deps: ExtractEmbeddingDeps = {},
): Promise<ExtractEmbeddingResponse> {
  let host = deps.host;
  let port = deps.port;
  if (host === undefined || port === undefined) {
    const config = getTtsRuntimeConfig();
    host = config.daemonHost;
    port = config.daemonPort;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? EXTRACT_EMBEDDING_TIMEOUT_MS);

  try {
    const response = await (deps.fetch ?? fetch)(`http://${host}:${port}/extract-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...await getTtsDaemonAuthHeaders() },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok) return { status: 503, body: { error: 'TTS daemon unavailable' } };
    return { status: 200, body: await response.json() };
  } catch {
    return { status: 503, body: { error: 'TTS daemon unavailable' } };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonBody(text: string): unknown | undefined {
  if (text.length > TTS_ROUTE_BODY_MAX_BYTES) return undefined;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return undefined;
  }
}

export function originErrorResponse(request: HttpServerRequest.HttpServerRequest): Response | undefined {
  const originCheck = validateOrigin(request);
  if (originCheck.ok) return undefined;
  return jsonResponse({ error: originCheck.error }, { status: 403 });
}

const getTtsHealthRoute = HttpRouter.add(
  'GET',
  '/api/tts/health',
  Effect.promise(() => checkTtsHealth()).pipe(
    Effect.map((health) => jsonResponse(health)),
  ),
);

const postTtsStartRoute = HttpRouter.add(
  'POST',
  '/api/tts/start',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;

    const result = yield* Effect.promise(() => startTtsDaemonFromDashboard());
    return jsonResponse(result, { status: result.ok ? 200 : 503 });
  }),
);

const getTtsVoicesRoute = HttpRouter.add(
  'GET',
  '/api/tts/voices',
  Effect.promise(() => listTtsVoices()).pipe(
    Effect.map((voices) => jsonResponse(voices)),
  ),
);

const postTtsVoiceRoute = HttpRouter.add(
  'POST',
  '/api/tts/voices',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;
    const payloadTooLarge = ttsPayloadTooLargeResponse(request);
    if (payloadTooLarge) return payloadTooLarge;

    const bodyRead = yield* readCappedTtsBodyText(request);
    if (!bodyRead.ok) return jsonResponse({ error: bodyRead.error }, { status: bodyRead.status });
    const body = parseJsonBody(bodyRead.text);
    if (body === undefined) return jsonResponse({ error: 'invalid JSON' }, { status: 400 });

    const input = parseCreateTtsVoiceInput(body);
    if (!input) return jsonResponse({ error: 'invalid voice' }, { status: 400 });

    const voice = yield* Effect.promise(() => createTtsVoice(input));
    return jsonResponse(voice);
  }),
);

const deleteTtsVoicesRoute = HttpRouter.add(
  'DELETE',
  '/api/tts/voices',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;

    const deleted = yield* Effect.promise(() => clearTtsVoices());
    return jsonResponse({ deleted });
  }),
);

const deleteTtsVoiceRoute = HttpRouter.add(
  'DELETE',
  '/api/tts/voices/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;

    const params = yield* HttpRouter.params;
    const deleted = yield* Effect.promise(() => removeTtsVoice(params.id));
    if (!deleted) return jsonResponse({ error: 'voice not found' }, { status: 404 });
    return jsonResponse({ deleted: true });
  }),
);

const postTtsSpeakRoute = HttpRouter.add(
  'POST',
  '/api/tts/speak',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;
    const payloadTooLarge = ttsPayloadTooLargeResponse(request);
    if (payloadTooLarge) return payloadTooLarge;

    const bodyRead = yield* readCappedTtsBodyText(request);
    if (!bodyRead.ok) return jsonResponse({ error: bodyRead.error }, { status: bodyRead.status });
    const body = parseJsonBody(bodyRead.text);
    if (body === undefined) return jsonResponse({ error: 'invalid JSON' }, { status: 400 });

    const input = parseSpeakTtsInput(body);
    if (!input) return jsonResponse({ error: 'invalid speak request' }, { status: 400 });

    const response = yield* Effect.promise(() => speakTts(input));
    return jsonResponse(response.body, { status: response.status });
  }),
);

const postExtractEmbeddingRoute = HttpRouter.add(
  'POST',
  '/api/tts/extract-embedding',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = originErrorResponse(request);
    if (originError) return originError;
    const payloadTooLarge = ttsPayloadTooLargeResponse(request);
    if (payloadTooLarge) return payloadTooLarge;

    const bodyRead = yield* readCappedTtsBodyText(request);
    if (!bodyRead.ok) return jsonResponse({ error: bodyRead.error }, { status: bodyRead.status });
    const body = parseJsonBody(bodyRead.text);
    if (body === undefined) return jsonResponse({ error: 'invalid JSON' }, { status: 400 });

    const input = parseExtractEmbeddingInput(body);
    if (!input) return jsonResponse({ error: 'invalid extraction request' }, { status: 400 });

    const response = yield* Effect.promise(() => extractTtsEmbedding(input));
    return jsonResponse(response.body, { status: response.status });
  }),
);

export const ttsRouteLayer = Layer.mergeAll(
  getTtsHealthRoute,
  postTtsStartRoute,
  getTtsVoicesRoute,
  postTtsVoiceRoute,
  deleteTtsVoicesRoute,
  deleteTtsVoiceRoute,
  postTtsSpeakRoute,
  postExtractEmbeddingRoute,
);
