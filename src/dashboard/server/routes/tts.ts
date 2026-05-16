import { Effect } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { loadConfig } from '../../../lib/config-yaml.js';
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

const getTtsHealthRoute = HttpRouter.add(
  'GET',
  '/api/tts/health',
  Effect.promise(() => checkTtsHealth()).pipe(
    Effect.map((health) => jsonResponse(health)),
  ),
);

export const ttsRouteLayer = getTtsHealthRoute;
