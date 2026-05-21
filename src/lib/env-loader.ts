/**
 * Environment Variable Loader
 *
 * Loads environment variables from ~/.panopticon.env into process.env.
 * This allows the settings system to access API keys configured in the .env file.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect, FileSystem } from 'effect';
import { FsError, FsNotFoundError } from './errors.js';

/**
 * Path to the Panopticon environment file
 */
export const ENV_FILE_PATH = join(homedir(), '.panopticon.env');

/**
 * Parse a .env file content into key-value pairs
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split('\n')) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Parse KEY=VALUE format
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Remove surrounding quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, '');
      result[key] = cleanValue;
    }
  }

  return result;
}

/**
 * Load environment variables from ~/.panopticon.env.
 * Does not override existing environment variables.
 *
 * Fails with `FsNotFoundError` if the env file does not exist.
 * Fails with `FsError` if the file cannot be read.
 */
export function loadPanopticonEnv(): Effect.Effect<
  { loaded: string[]; skipped: string[] },
  FsError | FsNotFoundError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const fileExists = yield* fs.exists(ENV_FILE_PATH).pipe(
      Effect.mapError((cause) => new FsError({ path: ENV_FILE_PATH, operation: 'exists', cause })),
    );

    if (!fileExists) {
      return yield* Effect.fail(new FsNotFoundError({ path: ENV_FILE_PATH }));
    }

    const content = yield* fs.readFileString(ENV_FILE_PATH, 'utf8').pipe(
      Effect.mapError((cause) =>
        new FsError({ path: ENV_FILE_PATH, operation: 'readFileString', cause }),
      ),
    );

    const envVars = parseEnvFile(content);
    const result: { loaded: string[]; skipped: string[] } = { loaded: [], skipped: [] };

    for (const [key, value] of Object.entries(envVars)) {
      if (process.env[key]) {
        result.skipped.push(key);
      } else {
        process.env[key] = value;
        result.loaded.push(key);
      }
    }

    return result;
  });
}

/**
 * Get API keys from environment (after loading ~/.panopticon.env)
 */
export function getApiKeysFromEnv(): {
  openai?: string;
  google?: string;
  kimi?: string;
  openrouter?: string;
  nous?: string;
} {
  return {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    kimi: process.env.KIMI_CODING_API_KEY || process.env.KIMI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    nous: process.env.NOUS_API_KEY,
  };
}

/**
 * Get shadow mode setting from environment (after loading ~/.panopticon.env)
 * Returns true if SHADOW_MODE is set to 'true', '1', or 'yes' (case insensitive)
 */
export function getShadowModeFromEnv(): boolean {
  const value = process.env.SHADOW_MODE;
  if (!value) return false;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
}

/**
 * Check if ~/.panopticon.env file exists
 */
export function hasEnvFile(): boolean {
  return existsSync(ENV_FILE_PATH);
}

/**
 * Get the path to the env file
 */
export function getEnvFilePath(): string {
  return ENV_FILE_PATH;
}
