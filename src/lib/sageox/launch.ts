/**
 * SageOx wiring for a managed launch (PAN-2444 FR-8, FR-9).
 *
 * The `sageox` skill pack toggle is the opt-in (D1). When it is on for a
 * Claude Code launch, the launch's git root holds `.sageox/` (D11), and the
 * `ox` on PATH answers the fork's host contract (D7), the launch gets the
 * host-managed env and six `ox agent hook` entries in its `--settings` JSON
 * (D13). Uploads stay off unless the project's upload flag is enabled (D6).
 *
 * Fail open for the launch, fail closed for SageOx (NFR-3): any failed
 * condition or error returns `active: false` with one warning line, and the
 * caller then excludes the `sageox` pack from the mount. Overdeck never runs
 * `ox init`, `ox login`, or an upload; it only sets env, hooks and the mount.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { SkillOverrideLayers } from '../skill-overrides/resolve.js';
import type { LaunchSkillContext } from '../skill-overrides/launch.js';
import type { OxProbeResult } from './probe.js';

const execFileAsync = promisify(execFile);

export const SAGEOX_PACK_ID = 'sageox';
export const SAGEOX_CLAUDE_EVENTS = ['SessionStart', 'PreCompact', 'PostToolUse', 'Stop', 'SessionEnd', 'UserPromptSubmit'] as const;

const GIT_ROOT_TIMEOUT_MS = 5000;
const WARN = '[launcher] WARNING:';

export interface SageoxClaudeSettings {
  env: Record<string, string>;
  hooks: Record<string, unknown[]>;
}

export interface SageoxLaunch {
  active: boolean;
  settings?: SageoxClaudeSettings;
  warnings: string[];
}

export interface SageoxLaunchDeps {
  loadLayers: (ctx: LaunchSkillContext) => Promise<{ layers: SkillOverrideLayers; projectKey?: string }>;
  gitRoot: (cwd: string) => Promise<string | null>;
  probe: () => Promise<OxProbeResult>;
  readUpload: (projectKey: string) => Promise<boolean>;
}

const defaultDeps: SageoxLaunchDeps = {
  loadLayers: async ctx => {
    const [{ resolveLaunchScope }, { loadSkillOverrideLayers }] = await Promise.all([
      import('../skill-overrides/launch.js'),
      import('../skill-overrides/store.js'),
    ]);
    const scope = await resolveLaunchScope(ctx);
    return { layers: await loadSkillOverrideLayers(scope), projectKey: scope.projectKey };
  },
  gitRoot: async cwd => {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
        timeout: GIT_ROOT_TIMEOUT_MS,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },
  probe: async () => (await import('./probe.js')).probeOxHostContract(),
  readUpload: async projectKey => (await import('./config.js')).readSageoxUpload(projectKey),
};

/** D1: the pack toggle, or any `sageox/<skill>` per-skill value, resolves on. */
async function sageoxActive(layers: SkillOverrideLayers): Promise<boolean> {
  const { resolvePackSkill, resolvePackToggle } = await import('../skill-overrides/resolve.js');
  if (resolvePackToggle(SAGEOX_PACK_ID, layers).enabled) return true;
  const ids = new Set(
    [layers.global, layers.project, layers.issue].flatMap(map =>
      Object.keys(map ?? {}).filter(id => id.startsWith(`${SAGEOX_PACK_ID}/`))),
  );
  // optIn=true: only explicit per-skill values count; the pack toggle was checked above.
  return [...ids].some(id => resolvePackSkill(id, true, layers).enabled);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** FR-8 env map. Uploads on flips both the network gate and publishing. */
export function sageoxEnv(projectRoot: string, upload: boolean): Record<string, string> {
  return {
    OX_HOST_MANAGED: '1',
    OX_PROJECT_ROOT: projectRoot,
    OX_HOST_NETWORK: upload ? 'on' : 'off',
    OX_SESSION_PUBLISHING: upload ? 'auto' : 'manual',
    SAGEOX_TELEMETRY: 'false',
    SAGEOX_FRICTION: 'false',
    SAGEOX_DAEMON: 'false',
    OX_NO_DAEMON: '1',
  };
}

/** One hook entry per event; each command carries the env inline (D13). */
export function sageoxClaudeHooks(env: Record<string, string>): Record<string, unknown[]> {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  return Object.fromEntries(SAGEOX_CLAUDE_EVENTS.map(event => [event, [{
    matcher: '',
    hooks: [{
      type: 'command',
      command: `if command -v ox >/dev/null 2>&1; then ${assignments} AGENT_ENV=claude-code ox agent hook ${event} 2>&1 || true; fi`,
    }],
  }]]));
}

async function resolve(ctx: LaunchSkillContext, harness: 'claude-code' | 'codex', deps: SageoxLaunchDeps): Promise<SageoxLaunch> {
  const { layers, projectKey } = await deps.loadLayers(ctx);
  if (!(await sageoxActive(layers))) return { active: false, warnings: [] };
  if (harness === 'codex') {
    return { active: false, warnings: [`${WARN} SageOx is on but supports Claude Code launches only; sageox skills and hooks not applied`] };
  }
  const root = await deps.gitRoot(ctx.cwd);
  if (!root) return { active: false, warnings: [`${WARN} SageOx not applied: ${ctx.cwd} is not in a git repository`] };
  if (!(await isDirectory(join(root, '.sageox')))) {
    return { active: false, warnings: [`${WARN} SageOx not applied: no .sageox/ at ${root}; run OX_HOST_MANAGED=1 ox init there once`] };
  }
  const probe = await deps.probe();
  if (!probe.ok) {
    return { active: false, warnings: [`${WARN} SageOx not applied: ox host contract probe failed (${probe.reason}); see pan doctor`] };
  }
  const upload = projectKey ? await deps.readUpload(projectKey) : false;
  const env = sageoxEnv(root, upload);
  return { active: true, settings: { env, hooks: sageoxClaudeHooks(env) }, warnings: [] };
}

/** SageOx wiring for one launch. Never throws: an error drops SageOx, not the launch. */
export async function resolveSageoxLaunch(
  ctx: LaunchSkillContext,
  harness: 'claude-code' | 'codex',
  deps: SageoxLaunchDeps = defaultDeps,
): Promise<SageoxLaunch> {
  try {
    return await resolve(ctx, harness, deps);
  } catch (error) {
    return { active: false, warnings: [`${WARN} SageOx not applied: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
