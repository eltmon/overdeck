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
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { ProcessSpawnError } from '../errors.js';
import {
  getDiffBase,
  getDiffStats,
  getCurrentHead,
  saveCheckpoint,
} from './inspect-checkpoints.js';
import { setReviewStatusSync } from '../review-status.js';
import { withBdMutex } from '../bd-mutex.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import {
  createSession,
  killSession,
  sessionExists,
} from '../tmux.js';
import { loadConfigSync as loadYamlConfig, resolveModel } from '../config-yaml.js';
import { getClaudePermissionFlagsSync } from '../claude-permissions.js';
import {
  getProviderForModelSync,
  setupCredentialFileAuthSync,
  clearCredentialFileAuthSync,
} from '../providers.js';
import type { ModelId } from '../settings.js';
import { getProviderEnvForModel, saveAgentRuntimeState, saveAgentState } from '../agents.js';
import { isIssueClosed } from './issue-closed.js';
import { readWorkspacePlanSync } from '../vbrief/io.js';
import { resolveTieredExecutionEnabled } from '../agents/tier-table.js';
import {
  deliverCommitForReview,
  loadPrdDraft,
  spawnTierSupervisor,
  supervisorAgentId,
} from '../agents/tier-supervisor.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
    const { stdout } = await execFileAsync('bd', ['show', beadId, '--json'], {
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
    try {
      const { stdout } = await execFileAsync('bd', ['show', beadId], {
        cwd: workspacePath,
        encoding: 'utf-8',
      });
      return stdout.trim() || `Bead ${beadId} (no description available)`;
    } catch {
      return `Bead ${beadId} (unable to read bead description)`;
    }
  }
}

async function buildInspectPromptPromise(context: InspectContext): Promise<string> {
  const templatePath = join(__dirname, 'prompts', 'inspect-agent.md');

  if (!existsSync(templatePath)) {
    throw new Error(`Inspect agent prompt template not found at ${templatePath}`);
  }

  const template = readFileSync(templatePath, 'utf-8');

  // Get bead description
  const beadDescription = await getBeadDescription(context.beadId, context.workspace);

  // Get diff scope
  const diffBase = await Effect.runPromise(getDiffBase(context.projectKey, context.issueId, context.workspace));
  const diffStats = await Effect.runPromise(getDiffStats(context.workspace, diffBase));

  const apiUrl = process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`;

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
    .replace(/\{\{resultStatus\}\}/g, '${RESULT_STATUS}')
    .replace(/\{\{resultNotes\}\}/g, '${RESULT_NOTES}');

  return `<!-- overdeck:orchestration-context-start -->\n${prompt}\n<!-- overdeck:orchestration-context-end -->`;
}

async function routeInspectToStandingSupervisorIfEnabled(
  context: InspectContext,
): Promise<{
  success: boolean;
  tmuxSession?: string;
  message: string;
  error?: string;
} | undefined> {
  const { config } = loadYamlConfig();
  const tiered = config.tieredExecution;
  if (!tiered?.supervisor?.owns_inspection) return undefined;

  const doc = readWorkspacePlanSync(context.workspace);
  const enabled = resolveTieredExecutionEnabled(tiered, doc?.plan.metadata);
  if (!enabled) return undefined;

  const item = doc?.plan.items.find(candidate => candidate.id === context.beadId);
  if (!doc || !item) {
    throw new Error(
      `Standing supervisor inspection for ${context.issueId} bead ${context.beadId} requires a readable vBRIEF item in ${context.workspace}.`,
    );
  }

  const agentId = supervisorAgentId(context.issueId);
  if (!await Effect.runPromise(sessionExists(agentId))) {
    await spawnTierSupervisor(context.issueId, tiered.supervisor, { workspace: context.workspace });
  }

  setReviewStatusSync(context.issueId.toUpperCase(), {
    inspectStatus: 'inspecting',
    inspectNotes: `Inspecting bead ${context.beadId}`,
    inspectStartedAt: new Date().toISOString(),
    inspectBeadId: context.beadId,
  });

  const sha = await Effect.runPromise(getCurrentHead(context.workspace));
  const prdMarkdown = await loadPrdDraft(context.projectPath, context.issueId);
  await deliverCommitForReview({
    supervisorAgentId: agentId,
    workspacePath: context.workspace,
    issueId: context.issueId,
    item,
    sha,
    beadId: context.beadId,
    prdMarkdown,
  });

  return {
    success: true,
    tmuxSession: agentId,
    message: `Routed inspect for ${context.issueId} bead ${context.beadId} to standing supervisor`,
  };
}

async function spawnInspectAgentPromise(
  context: InspectContext,
  opts: { deep?: boolean } = {},
): Promise<{
  success: boolean;
  skipped?: boolean;
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
    if (await isIssueClosed(context.issueId.toUpperCase())) {
      const message = `${context.issueId.toUpperCase()}: skipping inspect dispatch — issue is closed`;
      console.log(`[cloister] ${message}`);
      return {
        success: true,
        skipped: true,
        tmuxSession,
        message,
      };
    }

    const supervisorRoute = await routeInspectToStandingSupervisorIfEnabled(context);
    if (supervisorRoute) return supervisorRoute;

    if (await Effect.runPromise(sessionExists(tmuxSession))) {
      // Stale session left behind by a previous inspection run — clear it.
      await Effect.runPromise(killSession(tmuxSession)).catch(() => {});
    }

    const prompt = await Effect.runPromise(buildInspectPrompt(context));
    setReviewStatusSync(context.issueId.toUpperCase(), {
      inspectStatus: 'inspecting',
      inspectNotes: `Inspecting bead ${context.beadId}`,
      inspectStartedAt: new Date().toISOString(),
      inspectBeadId: context.beadId,
    });

    // Resolve model via the role primitive: work.<inspect|inspect-deep>.
    const { config } = loadYamlConfig();
    const model = resolveModel('work', subRole, config);

    // Provider env (BASE_URL/AUTH_TOKEN) for non-Anthropic models routed via cliproxy.
    const providerEnv = await getProviderEnvForModel(model);
    const provider = getProviderForModelSync(model as ModelId);
    if (provider.authType === 'credential-file') {
      setupCredentialFileAuthSync(provider, context.workspace);
    } else {
      clearCredentialFileAuthSync(context.workspace);
    }

    // Per-agent dir for prompt + launcher artifacts.
    const agentDir = join(homedir(), '.overdeck', 'agents', tmuxSession);
    mkdirSync(agentDir, { recursive: true });

    const promptFile = join(agentDir, 'task-prompt.md');
    writeFileSync(promptFile, prompt);

    const launcherScript = join(agentDir, 'launcher.sh');
    const sessionId = randomUUID();
    writeFileSync(
      launcherScript,
      generateLauncherScriptSync({
        role: 'work',
        workingDir: context.workspace,
        setTerminalEnv: true,
        unsetProviderEnv: true,
        providerExports: Object.entries(providerEnv)
          .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\"'\"'")}'`)
          .join('\n') + (Object.keys(providerEnv).length ? '\n' : ''),
        overdeckEnv: {
          agentId: tmuxSession,
          issueId: context.issueId,
          sessionType: subRole,
        },
        promptFile,
        // Inspect prompts are workflow-injected templates, not ambient .claude/agents
        // definitions. Passing --agent here skips launcher permission flags and can
        // strand the inspector at a permission dialog before it can send its verdict.
        baseCommand: 'claude',
        sessionId,
        model,
        permissionFlags: getClaudePermissionFlagsSync(),
      }),
      { mode: 0o755 },
    );

    const envForTmux: Record<string, string> = {
      OVERDECK_AGENT_ID: tmuxSession,
      OVERDECK_ISSUE_ID: context.issueId,
      OVERDECK_SESSION_TYPE: subRole,
      ...providerEnv,
    };

    await Effect.runPromise(createSession(
      tmuxSession,
      context.workspace,
      `bash '${launcherScript}'`,
      { env: envForTmux },
    ));

    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: context.issueId,
    });

    // PAN-1834 — write a minimal state.json so inspect agents are enumerated by
    // listRunningAgents and scanned by the enrichment poller for pending input.
    await Effect.runPromise(saveAgentState({
      id: tmuxSession,
      issueId: context.issueId,
      workspace: context.workspace,
      role: 'work',
      // The inspect launcher hardcodes `baseCommand: 'claude'` (above), so the
      // agent always runs under claude-code — record it. `harness` is optional on
      // AgentState but maps to a NOT NULL column; omitting it made the cache
      // backfill skip the agent (invisible) or, pre-PAN-1972, crash the boot
      // decode. PAN-1973.
      harness: 'claude-code',
      model,
      status: 'starting',
      startedAt: new Date().toISOString(),
      inspectSubRole: subRole,
    }));

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
}async function onInspectCompletePromise(
  projectKey: string,
  issueId: string,
  beadId: string,
  status: 'passed' | 'failed',
  workspacePath: string
): Promise<void> {
  if (status === 'passed') {
    const commitSha = await Effect.runPromise(getCurrentHead(workspacePath));
    saveCheckpoint(projectKey, issueId, beadId, commitSha);
    console.log(`[inspect] Checkpoint saved for ${issueId} bead ${beadId} at ${commitSha.substring(0, 8)}`);

  } else {
    console.log(`[inspect] Bead ${beadId} blocked for ${issueId} — no checkpoint saved`);
  }
}

// ─── PAN-1249: additive Effect variants ───────────────────────────────────────

/**
 * Effect-typed variant of {@link buildInspectPrompt}.
 * Fails with `ProcessSpawnError` when the prompt template is missing or the
 * underlying git/bd helpers throw (the legacy Promise version throws on the
 * missing-template path).
 */
export function buildInspectPrompt(
  context: InspectContext,
): Effect.Effect<string, ProcessSpawnError> {
  return Effect.tryPromise({
    try: () => buildInspectPromptPromise(context),
    catch: (cause) =>
      new ProcessSpawnError({
        command: 'inspect-agent',
        args: ['buildInspectPrompt', context.beadId],
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
}

/**
 * Effect-typed variant of {@link spawnInspectAgent}. Never fails — the legacy
 * Promise returns `{ success: false, error }` instead of throwing.
 */
export function spawnInspectAgent(
  context: InspectContext,
  opts: { deep?: boolean } = {},
): Effect.Effect<{
  success: boolean;
  skipped?: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  return Effect.promise(() => spawnInspectAgentPromise(context, opts));
}

/**
 * Effect-typed variant of {@link onInspectComplete}. Never fails.
 */
export function onInspectComplete(
  projectKey: string,
  issueId: string,
  beadId: string,
  status: 'passed' | 'failed',
  workspacePath: string,
): Effect.Effect<void> {
  return Effect.promise(() => onInspectCompletePromise(projectKey, issueId, beadId, status, workspacePath));
}
