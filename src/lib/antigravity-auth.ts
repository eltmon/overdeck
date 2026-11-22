/**
 * Antigravity (`agy`) credential resolution (PAN-5587 D3, D4, D6).
 *
 * Overdeck runs `agy acp` only with a Gemini API key (`gemini-api-key`) or
 * Agent Platform credentials (`agent-platform`). It never selects an OAuth
 * method: Antigravity's terms (clause 6) forbid using Antigravity OAuth through
 * third-party software. The ACP host calls `resolveAntigravityCredential` for
 * each launch; the settings picker and `pan doctor` call `readAntigravityAuthStatus`,
 * so all three apply the same rules.
 *
 * Resolution order (first match wins):
 *   1. Overdeck config `apiKeys.google` → `gemini-api-key`. A value that is still an
 *      unresolved env reference is rejected, because agent panes blank provider env vars.
 *   2. Agent Platform: project + location (env, else `gcp.*` in the isolated gemini dir's
 *      `antigravity-cli/settings.json`) + an Application Default Credentials file.
 *   3. Otherwise `AntigravityCredentialError(ANTIGRAVITY_AUTH_REQUIRED)`.
 *
 * Env `GEMINI_API_KEY` is deliberately never read: the dashboard process may have it
 * while every agent pane has it blanked. Credential values never appear in messages.
 */
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadConfigNoMigration } from './config-yaml.js';
import { getOverdeckHome } from './paths.js';

export type AntigravityAuthMethod = 'gemini-api-key' | 'agent-platform';
/** The only ACP auth methods Overdeck ever selects for agy (PAN-5587 D3). */
export const ANTIGRAVITY_AUTH_METHODS: readonly AntigravityAuthMethod[] = ['gemini-api-key', 'agent-platform'];

export const ANTIGRAVITY_OAUTH_NOT_OFFERED =
  "Overdeck never uses Antigravity's Google sign-in (OAuth): Antigravity's terms (clause 6) call accessing the service with it through third-party software a breach.";
export const ANTIGRAVITY_AUTH_REQUIRED =
  'Antigravity needs a Gemini API key or Agent Platform credentials. Set the Google API key in Overdeck Settings, ' +
  'or set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION and run gcloud auth application-default login. ' +
  ANTIGRAVITY_OAUTH_NOT_OFFERED;

export class AntigravityCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AntigravityCredentialError';
  }
}

export interface AntigravityCredential {
  readonly method: AntigravityAuthMethod;
  /** Env vars for the agy child process only. */
  readonly env: Readonly<Record<string, string>>;
  readonly source: 'settings' | 'agent-platform';
}

export interface AntigravityAuthDeps {
  /** Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Default: `loadConfigNoMigration().config.apiKeys`. */
  readonly loadApiKeys?: () => Promise<Partial<Record<string, string | undefined>>>;
  /** Default `antigravityGeminiDir()`. */
  readonly geminiDir?: string;
  /** Default `os.homedir()`. */
  readonly home?: string;
}

const UNRESOLVED_ENV_REFERENCE = /\$\{?[A-Z_][A-Z0-9_]*\}?/;

/** `<OVERDECK_HOME>/antigravity`: the isolated --gemini-dir (D6). */
export function antigravityGeminiDir(overdeckHome = getOverdeckHome()): string {
  return join(overdeckHome, 'antigravity');
}

async function defaultLoadApiKeys(): Promise<Partial<Record<string, string | undefined>>> {
  const { config } = await loadConfigNoMigration();
  return config.apiKeys;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

async function readGcpSettings(geminiDir: string): Promise<{ project?: string; location?: string }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(geminiDir, 'antigravity-cli', 'settings.json'), 'utf8'));
    const gcp = parsed && typeof parsed === 'object' ? (parsed as { gcp?: unknown }).gcp : undefined;
    if (!gcp || typeof gcp !== 'object') return {};
    const { project, location } = gcp as { project?: unknown; location?: unknown };
    return { project: nonEmpty(project), location: nonEmpty(location) };
  } catch {
    // A missing or unparseable settings file simply contributes nothing.
    return {};
  }
}

async function adcFileExists(env: NodeJS.ProcessEnv, home: string): Promise<boolean> {
  const path = nonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS)
    ?? join(home, '.config', 'gcloud', 'application_default_credentials.json');
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveAntigravityCredential(deps: AntigravityAuthDeps = {}): Promise<AntigravityCredential> {
  const env = deps.env ?? process.env;
  const apiKeys = await (deps.loadApiKeys ?? defaultLoadApiKeys)();
  const key = nonEmpty(apiKeys.google);
  if (key) {
    if (UNRESOLVED_ENV_REFERENCE.test(key)) {
      // The reference text is a variable name, not a secret.
      throw new AntigravityCredentialError(
        `The Google API key in Overdeck config is an environment reference (${key}) that agent panes do not receive. Put the literal key in Settings → Google.`,
      );
    }
    return { method: 'gemini-api-key', env: { GEMINI_API_KEY: key }, source: 'settings' };
  }

  const envProject = nonEmpty(env.GOOGLE_CLOUD_PROJECT);
  const envLocation = nonEmpty(env.GOOGLE_CLOUD_LOCATION);
  const settings = envProject && envLocation ? {} : await readGcpSettings(deps.geminiDir ?? antigravityGeminiDir());
  const project = envProject ?? settings.project;
  const location = envLocation ?? settings.location;
  if (project && location && await adcFileExists(env, deps.home ?? homedir())) {
    return {
      method: 'agent-platform',
      env: {
        ...(envProject ? { GOOGLE_CLOUD_PROJECT: envProject } : {}),
        ...(envLocation ? { GOOGLE_CLOUD_LOCATION: envLocation } : {}),
      },
      source: 'agent-platform',
    };
  }

  throw new AntigravityCredentialError(ANTIGRAVITY_AUTH_REQUIRED);
}

export async function readAntigravityAuthStatus(
  deps: AntigravityAuthDeps = {},
): Promise<{ ready: boolean; method: AntigravityAuthMethod | null }> {
  try {
    const credential = await resolveAntigravityCredential(deps);
    return { ready: true, method: credential.method };
  } catch (error) {
    if (error instanceof AntigravityCredentialError) return { ready: false, method: null };
    throw error;
  }
}
