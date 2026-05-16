import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { loadConfig } from '../../../lib/config-yaml.js';
import {
  addVoice as addStoredVoice,
  deleteVoice as deleteStoredVoice,
  loadVoices as loadStoredVoices,
  type TtsVoice,
} from '../../../lib/tts-voices.js';
import { jsonResponse } from '../http-helpers.js';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

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
    const { config } = loadConfig();
    host = config.tts.daemonHost;
    port = config.tts.daemonPort;
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

  return input;
}

export async function createTtsVoice(input: CreateTtsVoiceInput, store: TtsVoiceStore = {}): Promise<TtsVoice> {
  const addVoice = store.addVoice ?? addStoredVoice;
  return addVoice(input);
}

export async function removeTtsVoice(id: string, store: TtsVoiceStore = {}): Promise<boolean> {
  const deleteVoice = store.deleteVoice ?? deleteStoredVoice;
  return deleteVoice(id);
}

function parseJsonBody(text: string): unknown | undefined {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return undefined;
  }
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
    const body = parseJsonBody(yield* request.text);
    if (body === undefined) return jsonResponse({ error: 'invalid JSON' }, { status: 400 });

    const input = parseCreateTtsVoiceInput(body);
    if (!input) return jsonResponse({ error: 'invalid voice' }, { status: 400 });

    const voice = yield* Effect.promise(() => createTtsVoice(input));
    return jsonResponse(voice);
  }),
);

const deleteTtsVoiceRoute = HttpRouter.add(
  'DELETE',
  '/api/tts/voices/:id',
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const deleted = yield* Effect.promise(() => removeTtsVoice(params.id));
    if (!deleted) return jsonResponse({ error: 'voice not found' }, { status: 404 });
    return jsonResponse({ deleted: true });
  }),
);

export const ttsRouteLayer = Layer.mergeAll(
  getTtsHealthRoute,
  getTtsVoicesRoute,
  postTtsVoiceRoute,
  deleteTtsVoiceRoute,
);
