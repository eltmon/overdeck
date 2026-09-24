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
 * Permission deny patterns for Overdeck shared infrastructure. Work agents have
 * NO legitimate reason to delete or modify these — they're the orchestration substrate
 * that the agent itself depends on. Without these guards an xBRIEF action like
 * "delete the legacy .claude/agents/pan-*-agent.md files" can convince an agent
 * to brick its own runtime and every other running agent's runtime (PAN-1048
 * incident, 2026-05-09).
 *
 * Anything destructive on these paths must go through Overdeck CLI commands or
 * a human, never an agent's Bash/Write/Edit tool.
 */
// Claude Code's permission matcher requires `:*` at the END of the pattern
// (prefix-match the tool argument). Mid-glob `**/...` is rejected at startup
// with a "Settings Warning" dialog that blocks ALL agent input until
// dismissed (PAN-1024 incident, 2026-05-09). The Edit/Write matcher takes
// a glob, but Bash takes a command-prefix string — different syntax.
//
// These patterns are best-effort: they catch the literal-prefix cases
// (`rm .claude/agents/...`, `rm ~/.overdeck/...`). They cannot cover
// `cd .claude && rm -rf agents/`. The proper guard is a PreToolUse hook
// — tracked separately. These rules are the cheap belt-and-suspenders.
const OVERDECK_INFRA_DENY_PATTERNS = [
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
  // Overdeck installed binaries / hooks / config (~/.overdeck)
  'Bash(rm ~/.overdeck/:*)',
  'Bash(rm -rf ~/.overdeck/:*)',
  'Bash(rm -r ~/.overdeck/:*)',
  // Sacred conversation history — already documented as never-delete
  'Bash(rm ~/.claude/projects/:*)',
  'Bash(rm -rf ~/.claude/projects/:*)',
  'Bash(rm -r ~/.claude/projects/:*)',
  // Agents may observe tmux state, but they must not drive another session's input.
  'Bash(tmux send-keys:*)',
  'Bash(tmux -L overdeck send-keys:*)',
  'Bash(tmux paste-buffer:*)',
  'Bash(tmux -L overdeck paste-buffer:*)',
];

// Legacy invalid patterns from PAN-1024 first-pass that Claude Code rejects
// at startup with a blocking dialog. We strip these on every overlay write
// so existing workspace settings get auto-cleaned.
const INVALID_LEGACY_PATTERNS = new Set<string>([
  'Bash(rm:.claude/agents/**)',
  'Bash(rm:**/.claude/agents/**)',
  'Bash(rm:.claude/hooks/**)',
  'Bash(rm:**/.claude/hooks/**)',
  'Bash(rm:~/.overdeck/**)',
  'Bash(rm:**/.overdeck/**)',
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

/**
 * Inject Overdeck-infrastructure permission deny rules into the workspace's
 * .claude/settings.local.json. Idempotent — re-running merges patterns into
 * any existing permissions.deny block without disturbing other entries.
 */
export function injectOverdeckInfraDeny(workingDir: string): Effect.Effect<void, FsError> {
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
    const merged = new Set<string>([...cleaned, ...OVERDECK_INFRA_DENY_PATTERNS]);
    permissions.deny = Array.from(merged).sort();
    existing.permissions = permissions;

    yield* atomicWrite(settingsPath, JSON.stringify(existing, null, 2) + '\n');
  }).pipe(Effect.provide(NodeFileSystem.layer));
}

/**
 * Detect provider env var conflicts between ~/.claude/settings.json
 * and what Overdeck would set for the given model.
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
