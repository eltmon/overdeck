/**
 * Environment Variable Loader
 *
 * Loads environment variables from ~/.panopticon.env into process.env.
 * This allows the settings system to access API keys configured in the .env file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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
 * Load environment variables from ~/.panopticon.env
 * Does not override existing environment variables.
 *
 * @returns Object with loaded variables and any errors
 */
export function loadPanopticonEnv(): {
  loaded: string[];
  skipped: string[];
  error?: string;
} {
  const result = {
    loaded: [] as string[],
    skipped: [] as string[],
  };

  if (!existsSync(ENV_FILE_PATH)) {
    return { ...result, error: `Env file not found: ${ENV_FILE_PATH}` };
  }

  try {
    const content = readFileSync(ENV_FILE_PATH, 'utf-8');
    const envVars = parseEnvFile(content);

    for (const [key, value] of Object.entries(envVars)) {
      if (process.env[key]) {
        // Don't override existing env vars
        result.skipped.push(key);
      } else {
        process.env[key] = value;
        result.loaded.push(key);
      }
    }

    return result;
  } catch (error: any) {
    return { ...result, error: `Failed to load env file: ${error.message}` };
  }
}

/**
 * Get API keys from environment (after loading ~/.panopticon.env)
 */
export function getApiKeysFromEnv(): {
  openai?: string;
  google?: string;
  zai?: string;
  kimi?: string;
} {
  return {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    zai: process.env.ZAI_API_KEY,
    kimi: process.env.KIMI_API_KEY,
  };
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
