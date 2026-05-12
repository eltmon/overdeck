/**
 * PAN-382: Inspect Agent — Per-step verification specialist.
 *
 * Spawns after each bead completion to verify the implementation matches
 * its specification and architectural constraints before the agent
 * proceeds to the next bead.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  getDiffBase,
  getDiffStats,
  getCurrentHead,
  saveCheckpoint,
} from './inspect-checkpoints.js';
import { setReviewStatus } from '../review-status.js';
import { withBdMutex } from '../bd-mutex.js';
import { generateLauncherScript } from '../launcher-generator.js';
import {
  createSessionAsync,
  killSessionAsync,
  sessionExistsAsync,
} from '../tmux.js';
import { loadConfig as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { bypassPrefixForAgentFlag } from '../claude-permissions.js';
import {
  getProviderForModel,
  setupCredentialFileAuth,
  clearCredentialFileAuth,
} from '../providers.js';
import type { ModelId } from '../settings.js';
import { getProviderEnvForModel, saveAgentRuntimeState } from '../agents.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Context for an inspection request
 */
export interface InspectContext {
  projectKey: string;
  projectPath: string;
  issueId: string;
  beadId: string;
  workspace: string;
  branch?: string;
}

/**
 * Result of inspection
 */
export interface InspectResult {
  success: boolean;
  inspectResult: 'PASS' | 'BLOCKED';
  beadId: string;
  notes?: string;
}

/**
 * Read a bead's description using the bd CLI.
 */
async function getBeadDescription(beadId: string, workspacePath: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`bd show ${beadId} --json`, {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    const bead = JSON.parse(stdout);
    const parts: string[] = [];
    if (bead.title) parts.push(`**Title:** ${bead.title}`);
    if (bead.description) parts.push(`**Description:** ${bead.description}`);
    if (bead.acceptance) parts.push(`**Acceptance Criteria:** ${bead.acceptance}`);
    if (bead.notes) parts.push(`**Notes:** ${bead.notes}`);
    if (bead.labels?.length) parts.push(`**Labels:** ${bead.labels.join(', ')}`);
    return parts.join('\n\n') || `Bead ${beadId} (no description available)`;
  } catch {
    // Fallback: try without --json
    try {
      const { stdout } = await execAsync(`bd show ${beadId}`, {
        cwd: workspacePath,
        encoding: 'utf-8',
      });
      return stdout.trim() || `Bead ${beadId} (no description available)`;
    } catch {
      return `Bead ${beadId} (unable to read bead description)`;
    }
  }
}

/**
 * Detect the compile/lint command for the workspace.
 */
function detectCompileCommand(workspacePath: string): string {
  // Check for common project types
  const checks: Array<{ file: string; command: string }> = [
    { file: 'tsconfig.json', command: 'npx tsc --noEmit && npx eslint . --max-warnings=0 2>/dev/null || npx eslint .' },
    { file: 'package.json', command: 'npm run build 2>&1 | tail -20' },
    { file: 'pom.xml', command: './mvnw compile -q' },
    { file: 'Cargo.toml', command: 'cargo check' },
    { file: 'go.mod', command: 'go build ./...' },
  ];

  for (const check of checks) {
    // Check workspace root and common subdirectories
    for (const subdir of ['', 'fe', 'api', 'frontend', 'backend']) {
      const checkPath = subdir ? join(workspacePath, subdir, check.file) : join(workspacePath, check.file);
      if (existsSync(checkPath)) {
        const cwd = subdir ? `cd ${subdir} && ` : '';
        return `${cwd}${check.command}`;
      }
    }
  }

  return 'echo "No compile command detected — skipping compile check"';
}

/**
 * Build the prompt for the inspect specialist.
 */
export async function buildInspectPrompt(context: InspectContext): Promise<string> {
  const templatePath = join(__dirname, 'prompts', 'inspect-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Inspect agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Get bead description
  const beadDescription = await getBeadDescription(context.beadId, context.workspace);

  // Get diff scope
  const diffBase = await getDiffBase(context.projectKey, context.issueId, context.workspace);
  const diffStats = await getDiffStats(context.workspace, diffBase);
  const compileCommand = detectCompileCommand(context.workspace);

  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;

  // Replace template variables
  const prompt = template
    .replace(/\{\{apiUrl\}\}/g, apiUrl)
    .replace(/\{\{projectPath\}\}/g, context.projectPath)
    .replace(/\{\{issueId\}\}/g, context.issueId)
    .replace(/\{\{beadId\}\}/g, context.beadId)
    .replace(/\{\{workspacePath\}\}/g, context.workspace)
    .replace(/\{\{checkpoint\}\}/g, diffBase.substring(0, 8))
    .replace(/\{\{diffBase\}\}/g, diffBase)
    .replace(/\{\{diffStats\}\}/g, diffStats)
    .replace(/\{\{beadDescription\}\}/g, beadDescription)
    .replace(/\{\{compileCommand\}\}/g, compileCommand)
    .replace(/\{\{resultStatus\}\}/g, '${RESULT_STATUS}')  // Placeholder for specialist to fill
    .replace(/\{\{resultNotes\}\}/g, '${RESULT_NOTES}');    // Placeholder for specialist to fill

  return `<!-- panopticon:orchestration-context-start -->\n${prompt}\n<!-- panopticon:orchestration-context-end -->`;
}

/**
 * PAN-1048 R1: spawn the inspect sub-role for a bead.
 *
 * Replaces the legacy spawnEphemeralSpecialist call. Inspect is a work
 * sub-role: ephemeral, single-bead-scoped, runs the harness-agnostic
 * inspect prompt in its own tmux session, and signals back via pan tell.
 * None of the heavy specialist registry/run-log/grace machinery applies
 * here, so we use a minimal launcher path instead of the deleted generic
 * specialist dispatcher.
 *
 * Model resolves through resolveModel('work', 'inspect') (or 'inspect-deep'),
 * so the workhorse cascade and per-sub-role overrides work as designed.
 */
export async function spawnInspectAgent(
  context: InspectContext,
  opts: { deep?: boolean } = {},
): Promise<{
  success: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  const subRole = opts.deep ? 'inspect-deep' : 'inspect';
  const issueLower = context.issueId.toLowerCase();
  const beadSlug = context.beadId.replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 24);
  const tmuxSession = `inspect-${issueLower}-${beadSlug}`;

  try {
    if (await sessionExistsAsync(tmuxSession)) {
      // Stale session left behind by a previous inspection run — clear it.
      await killSessionAsync(tmuxSession).catch(() => {});
    }

    const prompt = await buildInspectPrompt(context);
    setReviewStatus(context.issueId.toUpperCase(), {
      inspectStatus: 'inspecting',
      inspectNotes: `Inspecting bead ${context.beadId}`,
    });

    // Resolve model via the role primitive: work.<inspect|inspect-deep>.
    const { config } = loadYamlConfig();
    const model = resolveModel('work', subRole, config);

    // Provider env (BASE_URL/AUTH_TOKEN) for non-Anthropic models routed via cliproxy.
    const providerEnv = await getProviderEnvForModel(model);
    const provider = getProviderForModel(model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuth(provider, context.workspace);
    } else {
      clearCredentialFileAuth(context.workspace);
    }

    // Per-agent dir for prompt + launcher artifacts.
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    mkdirSync(agentDir, { recursive: true });

    const promptFile = join(agentDir, 'task-prompt.md');
    writeFileSync(promptFile, prompt);

    const launcherScript = join(agentDir, 'launcher.sh');
    const sessionId = randomUUID();
    writeFileSync(
      launcherScript,
      generateLauncherScript({
        role: 'work',
        workingDir: context.workspace,
        setCi: true,
        setTerminalEnv: true,
        unsetProviderEnv: true,
        providerExports: Object.entries(providerEnv)
          .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\"'\"'")}'`)
          .join('\n') + (Object.keys(providerEnv).length ? '\n' : ''),
        panopticonEnv: {
          agentId: tmuxSession,
          issueId: context.issueId,
          sessionType: subRole,
        },
        promptFile,
        // PAN-1082: bypassPrefixForAgentFlag() injects --dangerously-skip-permissions
        // when claude.permissionMode === 'bypass'. Without it, the inspect run
        // falls back to Claude Code's default prompting behavior and may hit
        // permission prompts mid-run — exactly what happened in the PAN-1059 incident.
        baseCommand: `claude${bypassPrefixForAgentFlag()} --model ${model}`,
        sessionId,
        model,
      }),
      { mode: 0o755 },
    );

    const envForTmux: Record<string, string> = {
      PANOPTICON_AGENT_ID: tmuxSession,
      PANOPTICON_ISSUE_ID: context.issueId,
      PANOPTICON_SESSION_TYPE: subRole,
      ...providerEnv,
    };

    await createSessionAsync(
      tmuxSession,
      context.workspace,
      `bash '${launcherScript}'`,
      { env: envForTmux },
    );

    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: context.issueId,
    });

    return {
      success: true,
      runId: sessionId,
      tmuxSession,
      message: `Spawned ${subRole} for ${context.issueId} bead ${context.beadId}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      tmuxSession,
      message: `Failed to spawn ${subRole}: ${message}`,
      error: message,
    };
  }
}

/**
 * Handle inspect completion — called when the inspect specialist signals done.
 * Saves checkpoint on PASS.
 */
export async function onInspectComplete(
  projectKey: string,
  issueId: string,
  beadId: string,
  status: 'passed' | 'failed',
  workspacePath: string
): Promise<void> {
  if (status === 'passed') {
    const commitSha = await getCurrentHead(workspacePath);
    saveCheckpoint(projectKey, issueId, beadId, commitSha);
    console.log(`[inspect] Checkpoint saved for ${issueId} bead ${beadId} at ${commitSha.substring(0, 8)}`);

  } else {
    console.log(`[inspect] Bead ${beadId} blocked for ${issueId} — no checkpoint saved`);
  }
}
