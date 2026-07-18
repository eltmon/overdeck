/**
 * Cloister specialist spawn command and environment helpers.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { readCavemanVariant } from '../caveman/workspace.js';
import { resolveHarness } from '../harness-resolve.js';

const execAsync = promisify(exec);

function roleForSpecialistModel(specialistType: string): { role: 'plan' | 'work' | 'review' | 'test' | 'ship'; subRole?: string } {
  const normalized = specialistType.replace(/-agent$/, '');
  if (normalized === 'inspect') return { role: 'work', subRole: 'inspect' };
  if (normalized === 'inspect-deep') return { role: 'work', subRole: 'inspect-deep' };
  if (normalized === 'review') return { role: 'review' };
  if (normalized === 'test' || normalized === 'uat') return { role: 'test' };
  if (normalized === 'merge' || normalized === 'ship') return { role: 'ship' };
  if (normalized === 'planning' || normalized === 'plan') return { role: 'plan' };
  return { role: 'work' };
}


/**
 * Resolve git directories and branch name from a workspace path.
 * Handles both monorepo (single .git at root) and polyrepo (multiple .git in subdirs).
 * When task.branch is missing, detects it from the checked-out branch in git repos.
 */
async function resolveWorkspaceGitInfo(workspace: string | undefined, taskBranch: string | undefined): Promise<{
  gitDirs: string[];
  branch: string;
  isPolyrepo: boolean;
}> {
  const gitDirs: string[] = [];
  let branch = taskBranch || 'unknown';

  if (!workspace || workspace === 'unknown') {
    return { gitDirs, branch, isPolyrepo: false };
  }

  // Detect git directories
  if (existsSync(join(workspace, '.git'))) {
    gitDirs.push(workspace);
  } else {
    try {
      const entries = readdirSync(workspace, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && existsSync(join(workspace, entry.name, '.git'))) {
          gitDirs.push(join(workspace, entry.name));
        }
      }
    } catch {}
  }

  // Auto-resolve branch from git when not provided
  if (branch === 'unknown' && gitDirs.length > 0) {
    try {
      const { stdout } = await execAsync(
        `cd "${gitDirs[0]}" && git branch --show-current`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const detected = stdout.trim();
      if (detected) {
        branch = detected;
      }
    } catch {}
  }

  return { gitDirs, branch, isPolyrepo: gitDirs.length > 1 };
}

/**
 * Shell fragment that unsets every provider-routing env var a parent tmux server
 * may have leaked into its child sessions. The overdeck tmux server is long-lived
 * and inherits whatever env existed when it was spawned — so fresh Anthropic-model
 * agents can still see a stale ANTHROPIC_BASE_URL pointing at cliproxy, which
 * responds with "unknown provider for model claude-*" (PAN-705). Every launcher
 * script must run this before exec'ing claude.
 */
const PROVIDER_ENV_UNSETS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'API_TIMEOUT_MS',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
];
const PROVIDER_UNSET_CMD = `unset ${PROVIDER_ENV_UNSETS.join(' ')}`;

/**
 * Convert a providerEnv dict to bash export lines.
 * Non-Anthropic models (e.g. gpt-5.4 via cliproxy) need ANTHROPIC_BASE_URL set in the
 * script body after provider env vars are unset.
 */
function buildProviderExportLines(providerEnv: Record<string, string>): string {
  const entries = Object.entries(providerEnv);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `export ${k}="${v}"`).join('\n') + '\n';
}

/**
 * Build tmux -e flags for environment variables
 */
function buildTmuxEnvFlags(env: Record<string, string>): string {
  let flags = '';
  for (const [key, value] of Object.entries(env)) {
    flags += ` -e ${key}="${value.replace(/"/g, '\\"')}"`;
  }
  return flags;
}


export async function buildSpecialistBaseCommand(
  specialistType: string,
  model: string,
  sessionName?: string,
): Promise<string> {
  const { getAgentRuntimeBaseCommand } = await import('../agents.js');
  const role = roleForSpecialistModel(specialistType).role;
  const harness = await resolveHarness({ model, role });
  const agentDefinition = specialistType.startsWith('pan-')
    ? specialistType
    : `pan-${specialistType.endsWith('-agent')
      ? specialistType.slice(0, -'-agent'.length)
      : specialistType}-agent`;
  return getAgentRuntimeBaseCommand(model, sessionName, agentDefinition, harness);
}

/**
 * Build shell export lines for caveman compression for specialist agents.
 *
 * Excluded: inspect-agent (its INSPECTION PASSED/BLOCKED sentinels are parsed by Cloister).
 * Uses per-specialist-type intensity from config.
 *
 * @param specialistType  The specialist type (review-agent, test-agent, etc.)
 * @param workspacePath   Workspace path to read the A/B variant from (may be undefined)
 * @param config          Normalized caveman config
 * @returns               Shell export lines to inject into the inner script
 */
export async function buildSpecialistCavemanExports(
  specialistType: string,
  workspacePath: string | undefined,
  config: import('../config-yaml.js').NormalizedCavemanConfig
): Promise<string> {
  // inspect-agent: never compress — output contains sentinel strings parsed by Cloister
  if (specialistType === 'inspect-agent' || !config.enabled) return '';

  // Read the workspace's A/B variant if we have a workspace path
  const variant = workspacePath ? await Effect.runPromise(readCavemanVariant(workspacePath)) : 'off';
  if (variant === 'off') return '';
  if (variant === 'disabled') {
    return `export OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
  }

  // Map specialist type to caveman intensity mode
  const modeMap: Record<string, keyof typeof config.modes> = {
    'review-agent': 'review',
    'test-agent': 'test',
    'merge-agent': 'merge',
  };
  const modeKey = modeMap[specialistType];
  if (!modeKey) return '';

  const mode = config.modes[modeKey];
  if (mode === 'off' || mode === 'disabled') return '';

  return `export CAVEMAN_DEFAULT_MODE="${mode}"\nexport OVERDECK_CAVEMAN_VARIANT="${variant}"\n`;
}
