/**
 * SageOx wiring for a managed launch (PAN-2444 FR-8, FR-9).
 *
 * The `sageox` skill pack toggle is the opt-in (D1). When it is on for a
 * Claude Code or Codex launch and the Overdeck-built `ox` (PAN-4852 WI-7:
 * `<packdir>/<commit>/bin/ox`, never one on PATH) answers the fork's host
 * contract (D7), the launch places the project's binding into the git root's
 * `.sageox/` (PAN-4852 WI-13, AD-15/AD-16; a tracked or hand-made `.sageox/`
 * is used as it is) and gets the host-managed env and six `ox agent hook`
 * entries in its `--settings` JSON (D13); a Codex launch gets the same
 * commands in its `hooks.json` (WI-17, `codex-hooks.ts`). Each hook calls
 * the built `ox` by absolute path. Uploads stay off unless the project's
 * upload flag is enabled (D6). When SageOx resolves off, the launch removes a placed binding from its
 * cwd (AD-17).
 *
 * Fail open for the launch, fail closed for SageOx (NFR-3): any failed
 * condition or error returns `active: false` with one warning line, and the
 * caller then excludes the `sageox` pack from the mount. Overdeck never runs
 * `ox init`, `ox login`, or an upload; it only sets env, hooks and the mount.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SkillOverrideLayers } from '../skill-overrides/resolve.js';
import type { LaunchSkillContext } from '../skill-overrides/launch.js';
import type { OxBinary } from './binary.js';
import type { ensureSageoxPlaced, removeSageoxPlacement } from './placement.js';
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
  /** The built `ox` (absolute path) when active; Codex hooks call it (PAN-4852 WI-17). */
  bin?: string;
  settings?: SageoxClaudeSettings;
  warnings: string[];
}

export interface SageoxLaunchDeps {
  loadLayers: (ctx: LaunchSkillContext) => Promise<{ layers: SkillOverrideLayers; projectKey?: string }>;
  gitRoot: (cwd: string) => Promise<string | null>;
  resolveBinary: () => Promise<OxBinary>;
  probe: (bin: string) => Promise<OxProbeResult>;
  readUpload: (projectKey: string) => Promise<boolean>;
  place: (root: string, projectKey: string) => ReturnType<typeof ensureSageoxPlaced>;
  removePlacement: (root: string) => ReturnType<typeof removeSageoxPlacement>;
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
  resolveBinary: async () => (await import('./binary.js')).resolveOxBinary(),
  probe: async bin => (await import('./probe.js')).probeOxHostContract({ bin }),
  readUpload: async projectKey => (await import('./config.js')).readSageoxUpload(projectKey),
  place: async (root, projectKey) => (await import('./placement.js')).ensureSageoxPlaced(root, projectKey),
  removePlacement: async root => (await import('./placement.js')).removeSageoxPlacement(root),
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

/**
 * One `ox agent hook` command (PAN-4852 AD-25), shared by Claude Code and
 * Codex hooks: it runs the built `ox` by absolute path with the env inline,
 * and stays fail-open when the binary is gone.
 */
export function oxHookCommand(bin: string, env: Record<string, string>, agentEnv: 'claude-code' | 'codex', event: string): string {
  const assignments = Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const quotedBin = shellQuote(bin);
  return `if [ -x ${quotedBin} ]; then ${assignments} AGENT_ENV=${agentEnv} ${quotedBin} agent hook ${event} 2>&1 || true; fi`;
}

/** One hook entry per event; each command carries the env inline (D13). */
export function sageoxClaudeHooks(env: Record<string, string>, bin: string): Record<string, unknown[]> {
  return Object.fromEntries(SAGEOX_CLAUDE_EVENTS.map(event => [event, [{
    matcher: '',
    hooks: [{ type: 'command', command: oxHookCommand(bin, env, 'claude-code', event) }],
  }]]));
}

async function resolve(ctx: LaunchSkillContext, deps: SageoxLaunchDeps): Promise<SageoxLaunch> {
  const { layers, projectKey } = await deps.loadLayers(ctx);
  if (!(await sageoxActive(layers))) {
    // AD-17: switch-off removes a binding Overdeck placed; a failure costs one warning.
    try {
      await deps.removePlacement(ctx.cwd);
    } catch (error) {
      return { active: false, warnings: [`${WARN} SageOx placed files not removed: ${error instanceof Error ? error.message : String(error)}`] };
    }
    return { active: false, warnings: [] };
  }
  const root = await deps.gitRoot(ctx.cwd);
  if (!root) return { active: false, warnings: [`${WARN} SageOx not applied: ${ctx.cwd} is not in a git repository`] };
  const binary = await deps.resolveBinary();
  if (!binary.ok) return { active: false, warnings: [`${WARN} SageOx not applied: ${binary.message}`] };
  const probe = await deps.probe(binary.bin);
  if (!probe.ok) {
    return { active: false, warnings: [`${WARN} SageOx not applied: ox host contract probe failed (${probe.reason}); see pan doctor`] };
  }
  // AD-16: place only after the probe passes, so a failing launch leaves no half-placed `.sageox/`.
  if (!projectKey) return { active: false, warnings: [`${WARN} SageOx not applied: the launch has no project`] };
  const placed = await deps.place(root, projectKey);
  if (!placed.ok) return { active: false, warnings: [`${WARN} ${placed.warning}`] };
  const upload = await deps.readUpload(projectKey);
  const env = sageoxEnv(root, upload);
  return { active: true, bin: binary.bin, settings: { env, hooks: sageoxClaudeHooks(env, binary.bin) }, warnings: [] };
}

/**
 * SageOx wiring for one launch. Never throws: an error drops SageOx, not the
 * launch. Both harnesses resolve the same way; the caller writes the hooks.
 */
export async function resolveSageoxLaunch(
  ctx: LaunchSkillContext,
  _harness: 'claude-code' | 'codex',
  deps: SageoxLaunchDeps = defaultDeps,
): Promise<SageoxLaunch> {
  try {
    return await resolve(ctx, deps);
  } catch (error) {
    return { active: false, warnings: [`${WARN} SageOx not applied: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
