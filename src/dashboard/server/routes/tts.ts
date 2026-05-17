import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { resolveAndSpeak, type ResolveAndSpeakOptions, type TtsSpeakMode, type TtsSpeakResult } from '../../../lib/tts-speak.js';
import { getTtsRuntimeConfig } from '../services/tts-runtime-config.js';
import { validateOrigin } from './origin-validation.js';
import {
  addVoice as addStoredVoice,
  clearVoices as clearStoredVoices,
  deleteVoice as deleteStoredVoice,
  loadVoices as loadStoredVoices,
  type TtsVoice,
} from '../../../lib/tts-voices.js';
import { jsonResponse } from '../http-helpers.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const EXTRACT_EMBEDDING_TIMEOUT_MS = 60_000;

export interface TtsHealthResult {
  ok: boolean;
  queue?: unknown;
  model?: unknown;
  error?: string;
}

export interface CheckTtsHealthOptions {
  fetch?: FetchLike;
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export async function checkTtsHealth(options: CheckTtsHealthOptions = {}): Promise<TtsHealthResult> {
  let host = options.host;
  let port = options.port;
  if (host === undefined || port === undefined) {
    const config = getTtsRuntimeConfig();
    host = config.daemonHost;
    port = config.daemonPort;
  }

  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);

  try {
    const response = await fetchImpl(`http://${host}:${port}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, error: 'daemon unreachable' };
    const body = await response.json() as { queue?: unknown; model?: unknown };
    return { ok: true, queue: body.queue, model: body.model };
  } catch {
    return { ok: false, error: 'daemon unreachable' };
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
    if (!Array.isArray(record.embedding) || !record.embedding.every((value) => typeof value === 'number')) return undefined;
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
  if (typeof record.text !== 'string' || record.text.trim().length === 0) return undefined;

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
    if (!Array.isArray(record.embedding) || !record.embedding.every((value) => typeof value === 'number')) return undefined;
    input.embedding = record.embedding;
  }

  return input;
}

export function parseExtractEmbeddingInput(body: unknown): ExtractEmbeddingInput | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.design !== 'string' || record.design.trim().length === 0) return undefined;
  if (typeof record.text !== 'string' || record.text.trim().length === 0) return undefined;
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
      headers: { 'Content-Type': 'application/json' },
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

    const body = parseJsonBody(yield* request.text);
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

    const body = parseJsonBody(yield* request.text);
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

    const body = parseJsonBody(yield* request.text);
    if (body === undefined) return jsonResponse({ error: 'invalid JSON' }, { status: 400 });

    const input = parseExtractEmbeddingInput(body);
    if (!input) return jsonResponse({ error: 'invalid extraction request' }, { status: 400 });

    const response = yield* Effect.promise(() => extractTtsEmbedding(input));
    return jsonResponse(response.body, { status: response.status });
  }),
);

export const ttsRouteLayer = Layer.mergeAll(
  getTtsHealthRoute,
  getTtsVoicesRoute,
  postTtsVoiceRoute,
  deleteTtsVoicesRoute,
  deleteTtsVoiceRoute,
  postTtsSpeakRoute,
  postExtractEmbeddingRoute,
);
