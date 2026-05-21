import { Effect, FileSystem } from 'effect';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { FsError } from './errors.js';

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
 * Permission deny patterns for Panopticon shared infrastructure. Work agents have
 * NO legitimate reason to delete or modify these — they're the orchestration substrate
 * that the agent itself depends on. Without these guards a vBRIEF action like
 * "delete the legacy .claude/agents/pan-*-agent.md files" can convince an agent
 * to brick its own runtime and every other running agent's runtime (PAN-1048
 * incident, 2026-05-09).
 *
 * Anything destructive on these paths must go through Panopticon CLI commands or
 * a human, never an agent's Bash/Write/Edit tool.
 */
// Claude Code's permission matcher requires `:*` at the END of the pattern
// (prefix-match the tool argument). Mid-glob `**/...` is rejected at startup
// with a "Settings Warning" dialog that blocks ALL agent input until
// dismissed (PAN-1024 incident, 2026-05-09). The Edit/Write matcher takes
// a glob, but Bash takes a command-prefix string — different syntax.
//
// These patterns are best-effort: they catch the literal-prefix cases
// (`rm .claude/agents/...`, `rm ~/.panopticon/...`). They cannot cover
// `cd .claude && rm -rf agents/`. The proper guard is a PreToolUse hook
// — tracked separately. These rules are the cheap belt-and-suspenders.
const PANOPTICON_INFRA_DENY_PATTERNS = [
  // Agent definitions / launch templates
  'Bash(rm .claude/agents/:*)',
  'Bash(rm -rf .claude/agents/:*)',
  'Bash(rm -r .claude/agents/:*)',
  'Edit(.claude/agents/**)',
  'Write(.claude/agents/**)',
  // Hook scripts
  'Bash(rm .claude/hooks/:*)',
  'Bash(rm -rf .claude/hooks/:*)',
  'Bash(rm -r .claude/hooks/:*)',
  'Edit(.claude/hooks/**)',
  'Write(.claude/hooks/**)',
  // Panopticon installed binaries / hooks / config (~/.panopticon)
  'Bash(rm ~/.panopticon/:*)',
  'Bash(rm -rf ~/.panopticon/:*)',
  'Bash(rm -r ~/.panopticon/:*)',
  // Sacred conversation history — already documented as never-delete
  'Bash(rm ~/.claude/projects/:*)',
  'Bash(rm -rf ~/.claude/projects/:*)',
  'Bash(rm -r ~/.claude/projects/:*)',
  // Agents may observe tmux state, but they must not drive another session's input.
  'Bash(tmux send-keys:*)',
  'Bash(tmux -L panopticon send-keys:*)',
  'Bash(tmux paste-buffer:*)',
  'Bash(tmux -L panopticon paste-buffer:*)',
];

// Legacy invalid patterns from PAN-1024 first-pass that Claude Code rejects
// at startup with a blocking dialog. We strip these on every overlay write
// so existing workspace settings get auto-cleaned.
const INVALID_LEGACY_PATTERNS = new Set<string>([
  'Bash(rm:.claude/agents/**)',
  'Bash(rm:**/.claude/agents/**)',
  'Bash(rm:.claude/hooks/**)',
  'Bash(rm:**/.claude/hooks/**)',
  'Bash(rm:~/.panopticon/**)',
  'Bash(rm:**/.panopticon/**)',
  'Bash(rm:~/.claude/projects/**)',
  'Bash(rm:**/.claude/projects/**)',
]);

function atomicWrite(
  path: string,
  content: string,
): Effect.Effect<void, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tmpPath = join(tmpdir(), `pan-settings-${randomUUID()}.tmp`);
    yield* fs.writeFileString(tmpPath, content).pipe(
      Effect.mapError(e => new FsError({ path: tmpPath, operation: 'writeFileString', cause: e })),
    );
    yield* fs.rename(tmpPath, path).pipe(
      Effect.mapError(e => new FsError({ path, operation: 'rename', cause: e })),
    );
  });
}

function findNewestBackup(
  claudeDir: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs.readDirectory(claudeDir).pipe(
      Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
    );
    const backups = [...entries]
      .filter(e => e.startsWith(BACKUP_PREFIX))
      .sort()
      .reverse();
    return backups.length > 0 ? join(claudeDir, backups[0]) : undefined;
  });
}

function backupIfNeeded(
  claudeDir: string,
  currentContent: string,
): Effect.Effect<boolean, FsError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const newest = yield* findNewestBackup(claudeDir);
    if (newest) {
      const backupContent = yield* fs.readFileString(newest, 'utf-8').pipe(
        Effect.catch(() => Effect.succeed(null as string | null)),
      );
      if (backupContent === currentContent) return false;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(claudeDir, `${BACKUP_PREFIX}${timestamp}`);
    yield* fs.writeFileString(backupPath, currentContent).pipe(
      Effect.mapError(e => new FsError({ path: backupPath, operation: 'writeFileString', cause: e })),
    );
    return true;
  });
}

/**
 * Inject Panopticon-infrastructure permission deny rules into the workspace's
 * .claude/settings.local.json. Idempotent — re-running merges patterns into
 * any existing permissions.deny block without disturbing other entries.
 */
export function injectPanopticonInfraDeny(workingDir: string): Effect.Effect<void, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const claudeDir = join(workingDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.local.json');

    yield* fs.makeDirectory(claudeDir, { recursive: true }).pipe(
      Effect.mapError(e => new FsError({ path: claudeDir, operation: 'makeDirectory', cause: e })),
    );

    const settingsExists = yield* fs.exists(settingsPath).pipe(Effect.catch(() => Effect.succeed(false)));
    const existing = settingsExists
      ? yield* fs.readFileString(settingsPath, 'utf-8').pipe(
          Effect.mapError(
            e => new FsError({ path: settingsPath, operation: 'readFileString', cause: e }),
          ),
          Effect.flatMap(raw =>
            Effect.try({
              try: () => JSON.parse(raw) as Record<string, unknown>,
              catch: e => new FsError({ path: settingsPath, operation: 'JSON.parse', cause: e }),
            }),
          ),
          Effect.catch(() => Effect.succeed({} as Record<string, unknown>)),
        )
      : ({} as Record<string, unknown>);

    const permissions = (existing.permissions as Record<string, unknown> | undefined) ?? {};
    const denyList = (permissions.deny as string[] | undefined) ?? [];
    const cleaned = denyList.filter(p => !INVALID_LEGACY_PATTERNS.has(p));
    const merged = new Set<string>([...cleaned, ...PANOPTICON_INFRA_DENY_PATTERNS]);
    permissions.deny = Array.from(merged).sort();
    existing.permissions = permissions;

    yield* atomicWrite(settingsPath, JSON.stringify(existing, null, 2) + '\n');
  }).pipe(Effect.provide(NodeFileSystem.layer));
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
export function injectProviderEnvOverlay(
  workingDir: string,
  providerEnv: Record<string, string>,
): Effect.Effect<OverlayResult, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const claudeDir = join(workingDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.local.json');

    yield* fs.makeDirectory(claudeDir, { recursive: true }).pipe(
      Effect.mapError(e => new FsError({ path: claudeDir, operation: 'makeDirectory', cause: e })),
    );

    const settingsExists = yield* fs.exists(settingsPath).pipe(Effect.catch(() => Effect.succeed(false)));
    let existingRaw = '';
    const existing = settingsExists
      ? yield* fs.readFileString(settingsPath, 'utf-8').pipe(
          Effect.mapError(
            e => new FsError({ path: settingsPath, operation: 'readFileString', cause: e }),
          ),
          Effect.flatMap(raw =>
            Effect.try({
              try: () => {
                existingRaw = raw;
                return JSON.parse(raw) as Record<string, unknown>;
              },
              catch: e => new FsError({ path: settingsPath, operation: 'JSON.parse', cause: e }),
            }),
          ),
          Effect.catch(() => Effect.succeed({} as Record<string, unknown>)),
        )
      : ({} as Record<string, unknown>);

    const backedUp = existingRaw ? yield* backupIfNeeded(claudeDir, existingRaw) : false;
    const backupPath = backedUp ? yield* findNewestBackup(claudeDir) : undefined;

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

    yield* atomicWrite(settingsPath, JSON.stringify(existing, null, 2) + '\n');

    return { settingsPath, backedUp, backupPath, keysInjected };
  }).pipe(Effect.provide(NodeFileSystem.layer));
}

/**
 * Remove Panopticon's provider env overlay from settings.local.json.
 * Restores the file to its pre-overlay state by removing only the
 * provider env keys we injected.
 */
export function removeProviderEnvOverlay(workingDir: string): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const settingsPath = join(workingDir, '.claude', 'settings.local.json');

    const exists = yield* fs.exists(settingsPath).pipe(Effect.catch(() => Effect.succeed(false)));
    if (!exists) return;

    const raw = yield* fs.readFileString(settingsPath, 'utf-8').pipe(
      Effect.catch(() => Effect.succeed(null as string | null)),
    );
    if (!raw) return;

    const settings = yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: e => new FsError({ path: settingsPath, operation: 'JSON.parse', cause: e }),
    }).pipe(Effect.catch(() => Effect.succeed(null as Record<string, unknown> | null)));
    if (!settings) return;

    const envBlock = settings.env as Record<string, string> | undefined;
    if (!envBlock) return;

    for (const key of PROVIDER_ENV_KEYS) {
      delete envBlock[key];
    }

    if (Object.keys(envBlock).length === 0) {
      delete settings.env;
    }

    yield* atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + '\n').pipe(
      Effect.catch(() => Effect.void),
    );
  }).pipe(Effect.provide(NodeFileSystem.layer));
}

/**
 * Detect provider env var conflicts between ~/.claude/settings.json
 * and what Panopticon would set for the given model.
 * Returns only keys where the user's value DIFFERS from the proposed value.
 */
export function detectProviderEnvConflicts(
  proposedEnv: Record<string, string>,
): Effect.Effect<ProviderEnvConflict[], never> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const userSettingsPath = join(homedir(), '.claude', 'settings.json');
    const conflicts: ProviderEnvConflict[] = [];

    const raw = yield* fs.readFileString(userSettingsPath, 'utf-8').pipe(
      Effect.catch(() => Effect.succeed(null as string | null)),
    );
    if (!raw) return conflicts;

    const userSettings = yield* Effect.try({
      try: () => JSON.parse(raw) as Record<string, unknown>,
      catch: e => new FsError({ path: userSettingsPath, operation: 'JSON.parse', cause: e }),
    }).pipe(Effect.catch(() => Effect.succeed(null as Record<string, unknown> | null)));
    if (!userSettings) return conflicts;

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
  }).pipe(Effect.provide(NodeFileSystem.layer));
}
