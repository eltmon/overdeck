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
  openrouter?: string;
} {
  return {
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    zai: process.env.ZAI_API_KEY,
    kimi: process.env.KIMI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
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
 * Get memory guard thresholds from environment variables.
 * PAN_MEMORY_WARN_GB: warning threshold in GB (default 4)
 * PAN_MEMORY_BLOCK_GB: critical block threshold in GB (default 2)
 */
export function getMemoryThresholds(): { warnBytes: number; blockBytes: number } {
  const GB = 1024 ** 3;
  const warnGB = parseFloat(process.env.PAN_MEMORY_WARN_GB ?? '4');
  const blockGB = parseFloat(process.env.PAN_MEMORY_BLOCK_GB ?? '2');
  return {
    warnBytes: (isNaN(warnGB) ? 4 : warnGB) * GB,
    blockBytes: (isNaN(blockGB) ? 2 : blockGB) * GB,
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
