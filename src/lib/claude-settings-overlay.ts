import { Effect } from 'effect';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FsError } from './errors.js';

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
];

export interface ProviderEnvConflict {
  key: string;
  userValue: string;
  proposedValue: string | undefined;
  source: string;
}

interface OverlayResult {
  settingsPath: string;
  backedUp: boolean;
  backupPath?: string;
  keysInjected: string[];
}

/** Compatibility no-op: repository-native Claude settings are user-owned. */
export function injectOverdeckInfraDeny(workingDir: string): Effect.Effect<void, FsError> {
  void workingDir;
  return Effect.void;
}

/** Compatibility no-op: provider configuration is exported by the launcher. */
export function injectProviderEnvOverlay(
  workingDir: string,
  providerEnv: Record<string, string>,
): Effect.Effect<OverlayResult, FsError> {
  void providerEnv;
  return Effect.succeed({ settingsPath: workingDir, backedUp: false, keysInjected: [] });
}

/** Compatibility no-op: Overdeck no longer installs repository overlays. */
export function removeProviderEnvOverlay(workingDir: string): Effect.Effect<void, never> {
  void workingDir;
  return Effect.void;
}

/**
 * Read-only diagnostic used by the settings UI. This never mutates the user's
 * native Claude config.
 */
export function detectProviderEnvConflicts(
  proposedEnv: Record<string, string>,
): Effect.Effect<ProviderEnvConflict[], never> {
  return Effect.promise(async () => {
    const userSettingsPath = join(homedir(), '.claude', 'settings.json');
    try {
      const parsed = JSON.parse(await readFile(userSettingsPath, 'utf-8')) as Record<string, unknown>;
      const userEnv = (parsed.env as Record<string, string> | undefined) ?? {};
      return PROVIDER_ENV_KEYS.flatMap((key): ProviderEnvConflict[] => {
        const userValue = userEnv[key];
        if (userValue === undefined || userValue === proposedEnv[key]) return [];
        return [{ key, userValue, proposedValue: proposedEnv[key], source: userSettingsPath }];
      });
    } catch {
      return [];
    }
  });
}
