import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { getPanopticonHome } from '../../../lib/paths.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateOrigin } from './origin-validation.js';

export interface VoiceSettings {
  stt: {
    provider: 'moonshine' | 'google-cloud';
    moonshine: { model: string };
    googleCloud: { apiKey: string; model: string };
  };
}

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stt: {
    provider: 'moonshine',
    moonshine: { model: 'base' },
    googleCloud: { apiKey: '', model: 'latest_long' },
  },
};

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

function voiceSettingsPath(): string {
  return join(getPanopticonHome(), 'voice-settings.json');
}

function isVoiceSettings(value: unknown): value is VoiceSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<VoiceSettings>;
  const stt = settings.stt;
  if (!stt || typeof stt !== 'object') return false;
  const provider = stt.provider;
  if (provider !== 'moonshine' && provider !== 'google-cloud') return false;
  return (
    !!stt.moonshine &&
    typeof stt.moonshine === 'object' &&
    typeof stt.moonshine.model === 'string' &&
    !!stt.googleCloud &&
    typeof stt.googleCloud === 'object' &&
    typeof stt.googleCloud.apiKey === 'string' &&
    typeof stt.googleCloud.model === 'string'
  );
}

function normalizeVoiceSettings(value: VoiceSettings): VoiceSettings {
  return {
    stt: {
      provider: value.stt.provider,
      moonshine: { model: value.stt.moonshine.model || DEFAULT_VOICE_SETTINGS.stt.moonshine.model },
      googleCloud: {
        apiKey: value.stt.googleCloud.apiKey,
        model: value.stt.googleCloud.model || DEFAULT_VOICE_SETTINGS.stt.googleCloud.model,
      },
    },
  };
}

export async function loadVoiceSettings(): Promise<VoiceSettings> {
  try {
    const raw = await readFile(voiceSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isVoiceSettings(parsed) ? normalizeVoiceSettings(parsed) : DEFAULT_VOICE_SETTINGS;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return DEFAULT_VOICE_SETTINGS;
    }
    throw error;
  }
}

async function saveVoiceSettings(settings: VoiceSettings): Promise<VoiceSettings> {
  const existing = await loadVoiceSettings();
  const normalized = normalizeVoiceSettings({
    ...settings,
    stt: {
      ...settings.stt,
      googleCloud: {
        ...settings.stt.googleCloud,
        apiKey: settings.stt.googleCloud.apiKey || existing.stt.googleCloud.apiKey,
      },
    },
  });
  const path = voiceSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
  return normalized;
}

const voiceSettingsListeners = new Set<(settings: VoiceSettings) => void>();

export function subscribeVoiceSettings(listener: (settings: VoiceSettings) => void): () => void {
  voiceSettingsListeners.add(listener);
  return () => voiceSettingsListeners.delete(listener);
}

function notifyVoiceSettings(settings: VoiceSettings): void {
  for (const listener of voiceSettingsListeners) listener(settings);
}

function redactVoiceSettings(settings: VoiceSettings): VoiceSettings & { stt: VoiceSettings['stt'] & { googleCloud: VoiceSettings['stt']['googleCloud'] & { hasApiKey: boolean } } } {
  return {
    stt: {
      ...settings.stt,
      googleCloud: {
        ...settings.stt.googleCloud,
        apiKey: '',
        hasApiKey: settings.stt.googleCloud.apiKey.trim().length > 0,
      },
    },
  };
}

function requireTrustedOrigin(request: HttpServerRequest.HttpServerRequest) {
  const originCheck = validateOrigin(request);
  return originCheck.ok ? null : jsonResponse({ error: originCheck.error }, { status: 403 });
}

const getVoiceSettingsRoute = HttpRouter.add(
  'GET',
  '/api/voice/settings',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    return yield* Effect.promise(async () => jsonResponse(redactVoiceSettings(await loadVoiceSettings())));
  })),
);

const putVoiceSettingsRoute = HttpRouter.add(
  'PUT',
  '/api/voice/settings',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const body = yield* readJsonBody;
    if (!isVoiceSettings(body)) {
      return jsonResponse({ error: 'Invalid voice settings payload' }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const settings = await saveVoiceSettings(body);
      notifyVoiceSettings(settings);
      return jsonResponse(redactVoiceSettings(settings));
    });
  })),
);

export const voiceRouteLayer = Layer.mergeAll(
  getVoiceSettingsRoute,
  putVoiceSettingsRoute,
);
