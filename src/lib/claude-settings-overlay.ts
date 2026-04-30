import { mkdir, readFile, writeFile, readdir, rename, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';

const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
];

const BACKUP_PREFIX = 'settings.local.json.pan-backup-';

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

/**
 * Inject provider env vars into .claude/settings.local.json.
 *
 * Claude Code's settings.json `env` block overrides process-level env vars,
 * so launcher script exports are insufficient when users have provider env
 * vars (like ANTHROPIC_BASE_URL) in their ~/.claude/settings.json. Project-level
 * settings.local.json has higher precedence than user-level settings.json,
 * so injecting here guarantees our provider config wins.
 *
 * Creates a timestamped backup before modifying, unless an identical backup
 * already exists.
 */
export async function injectProviderEnvOverlay(
  workingDir: string,
  providerEnv: Record<string, string>,
): Promise<OverlayResult> {
  const claudeDir = join(workingDir, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');

  if (!existsSync(claudeDir)) {
    await mkdir(claudeDir, { recursive: true });
  }

  let existing: Record<string, unknown> = {};
  let existingRaw = '';
  if (existsSync(settingsPath)) {
    try {
      existingRaw = await readFile(settingsPath, 'utf-8');
      existing = JSON.parse(existingRaw);
    } catch {
      existing = {};
      existingRaw = '';
    }
  }

  const backedUp = existingRaw ? await backupIfNeeded(claudeDir, existingRaw) : false;
  const backupPath = backedUp
    ? (await findNewestBackup(claudeDir))
    : undefined;

  const envBlock = (existing.env as Record<string, string> | undefined) ?? {};
  const keysInjected: string[] = [];

  for (const key of PROVIDER_ENV_KEYS) {
    if (key in providerEnv) {
      envBlock[key] = providerEnv[key];
      keysInjected.push(key);
    } else {
      // Blank the key so project-level overrides user-level settings.json.
      // Claude Code deep-merges configs — deleting a key lets user-level win.
      envBlock[key] = '';
      keysInjected.push(key);
    }
  }

  existing.env = Object.keys(envBlock).length > 0 ? envBlock : undefined;
  if (existing.env === undefined) delete existing.env;

  await atomicWrite(settingsPath, JSON.stringify(existing, null, 2) + '\n');

  return { settingsPath, backedUp, backupPath, keysInjected };
}

/**
 * Remove Panopticon's provider env overlay from settings.local.json.
 * Restores the file to its pre-overlay state by removing only the
 * provider env keys we injected.
 */
export async function removeProviderEnvOverlay(
  workingDir: string,
): Promise<void> {
  const settingsPath = join(workingDir, '.claude', 'settings.local.json');
  if (!existsSync(settingsPath)) return;

  try {
    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const envBlock = settings.env as Record<string, string> | undefined;
    if (!envBlock) return;

    for (const key of PROVIDER_ENV_KEYS) {
      delete envBlock[key];
    }

    if (Object.keys(envBlock).length === 0) {
      delete settings.env;
    }

    await atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  } catch {
    // If we can't parse the file, leave it alone
  }
}

/**
 * Detect provider env var conflicts between ~/.claude/settings.json
 * and what Panopticon would set for the given model.
 * Returns only keys where the user's value DIFFERS from the proposed value.
 */
export async function detectProviderEnvConflicts(
  proposedEnv: Record<string, string>,
): Promise<ProviderEnvConflict[]> {
  const userSettingsPath = join(homedir(), '.claude', 'settings.json');
  const conflicts: ProviderEnvConflict[] = [];

  let userSettings: Record<string, unknown> = {};
  try {
    const raw = await readFile(userSettingsPath, 'utf-8');
    userSettings = JSON.parse(raw);
  } catch {
    return conflicts;
  }

  const userEnv = (userSettings.env as Record<string, string> | undefined) ?? {};

  for (const key of PROVIDER_ENV_KEYS) {
    const userValue = userEnv[key];
    if (userValue === undefined) continue;

    const proposedValue = proposedEnv[key];
    if (userValue === proposedValue) continue;

    conflicts.push({
      key,
      userValue,
      proposedValue,
      source: userSettingsPath,
    });
  }

  return conflicts;
}

async function backupIfNeeded(claudeDir: string, currentContent: string): Promise<boolean> {
  const newest = await findNewestBackup(claudeDir);
  if (newest) {
    try {
      const backupContent = await readFile(newest, 'utf-8');
      if (backupContent === currentContent) return false;
    } catch {
      // Can't read backup — create a new one
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(claudeDir, `${BACKUP_PREFIX}${timestamp}`);
  await writeFile(backupPath, currentContent, 'utf-8');
  return true;
}

async function findNewestBackup(claudeDir: string): Promise<string | undefined> {
  try {
    const entries = await readdir(claudeDir);
    const backups = entries
      .filter(e => e.startsWith(BACKUP_PREFIX))
      .sort()
      .reverse();
    return backups.length > 0 ? join(claudeDir, backups[0]) : undefined;
  } catch {
    return undefined;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = join(tmpdir(), `pan-settings-${randomUUID()}.tmp`);
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, path);
}
