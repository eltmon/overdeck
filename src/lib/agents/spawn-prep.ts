import { existsSync } from 'fs';
import { basename, join } from 'path';
import { Effect } from 'effect';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getClaudePermissionFlagsStringSync } from '../claude-permissions.js';
import { loadConfigSync } from '../config.js';
import { loadConfigSync as loadYamlConfig } from '../config-yaml.js';
import type { RoleEffort } from '../config-yaml.js';
import { getFlywheelActiveRunIdSync } from '../overdeck/control-settings.js';
import { createTrackerFromConfig, createTracker } from '../tracker/factory.js';
import type { IssueState } from '../tracker/interface.js';
import { findProjectByPathSync, getIssuePrefix, resolveProjectFromIssueSync } from '../projects.js';
import { getWorkspaceStackHealth } from '../workspace/stack-health.js';
import { generateLauncherScriptSync } from '../launcher-generator.js';
import { getProviderForModelSync, setupCredentialFileAuthSync, clearCredentialFileAuthSync } from '../providers.js';
import type { ModelId, ComplexityLevel } from '../settings.js';
import { requireModelOverrideSync } from '../model-validation.js';
import type { MemoryIdentity } from '@overdeck/contracts';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import type { RuntimeName } from '../runtimes/types.js';
import { readWorkspacePlanSync } from '../vbrief/io.js';
import { type Role } from './agent-state.js';
import { assignDispatchTier } from './dispatch-tier.js';
import { resolveTieredExecutionEnabled } from './tier-table.js';
import {
  buildCavemanExports,
  getProviderEnvForModel,
  getProviderExportsForModel,
} from './provider-env.js';
import {
  claudeSystemPromptFiles,
  getAgentRuntimeBaseCommand,
  getCodexLauncherFields,
  getOhmypiLauncherFields,
  inferMemoryProjectId,
  roleAgentDefinitionPath,
  roleSystemPromptInjectionSync,
  getRoleRuntimeBaseCommand,
} from './runtime-command.js';

export type FlywheelSpawnEnv = {
  OVERDECK_FLYWHEEL_RUN_ID?: string;
  OVERDECK_FLYWHEEL_AGENT_ROLE?: Role;
};

export function normalizeFlywheelRunId(runId: string | null | undefined): string | undefined {
  if (!runId) return undefined;
  const trimmed = runId.trim();
  return /^RUN-\d+$/.test(trimmed) ? trimmed : undefined;
}

export function resolveFlywheelSpawnEnv(role: Role, runIdOverride?: string | null): FlywheelSpawnEnv {
  const runId = normalizeFlywheelRunId(runIdOverride ?? getFlywheelActiveRunIdSync());
  return runId
    ? { OVERDECK_FLYWHEEL_RUN_ID: runId, OVERDECK_FLYWHEEL_AGENT_ROLE: role }
    : {};
}

export function flywheelEnvExports(env: FlywheelSpawnEnv): string[] {
  return [
    env.OVERDECK_FLYWHEEL_RUN_ID ? `export OVERDECK_FLYWHEEL_RUN_ID=${env.OVERDECK_FLYWHEEL_RUN_ID}` : undefined,
    env.OVERDECK_FLYWHEEL_AGENT_ROLE ? `export OVERDECK_FLYWHEEL_AGENT_ROLE=${env.OVERDECK_FLYWHEEL_AGENT_ROLE}` : undefined,
  ].filter((value): value is string => value !== undefined);
}

export interface SpawnOptions {
  issueId: string;
  workspace: string;
  /** Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted. */
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  /**
   * Spawn role. Defaults to 'work'. The 'strike' role is the bypass path that
   * skips plan/review/test/ship and lands directly on main — see roles/strike.md.
   * Strike sessions are named `strike-<issue-id>` instead of `agent-<issue-id>`.
   */
  role?: 'work' | 'strike';
  difficulty?: ComplexityLevel;
  agentType?: 'review-agent' | 'test-agent' | 'merge-agent' | 'work-agent';

  // Work type system (PAN-118)
  phase?: 'exploration' | 'implementation' | 'testing' | 'documentation' | 'review-response' | 'planning' | 'synthesis';
  workType?: string; // Explicit work type ID (overrides phase-based detection)

  /**
   * Optional registered slot agent id. Omitted for the default one-work-agent
   * path; set only by spawnRun when launching a per-item slot.
   */
  agentId?: string;
  /** Registered swarm slot index for per-item work-agent spawning. */
  slotIndex?: number;
  /** vBRIEF item id assigned to the registered swarm slot. */
  slotItemId?: string;
  allowHost?: boolean;
  flywheelRunId?: string;
  /** Claude Code `--effort` level for the spawned session (work/strike). */
  effort?: RoleEffort;
}

export interface SpawnRunOptions {
  workspace?: string;
  harness?: RuntimeName;
  model?: string;
  prompt?: string;
  agentId?: string;
  /**
   * Sub-role within the review convoy (PAN-1059).
   * When set alongside role='review', each convoy reviewer gets its own
   * isolated tmux session using the code-review-<subRole> agent definition.
   * Values: 'security' | 'correctness' | 'performance' | 'requirements'
   */
  subRole?: string;
  /**
   * Review convoy wiring (PAN-977). When spawning a review sub-role, the
   * synthesis agent id and the reviewer's output path are passed in up front
   * so the generated launcher can own the REVIEWER_READY/FAILED/TIMEOUT signal
   * deterministically on process exit. Persisted onto AgentState too.
   */
  reviewSynthesisAgentId?: string;
  reviewOutputPath?: string;
  allowHost?: boolean;
  registerConversation?: boolean;
  effort?: RoleEffort;
  resumeSessionId?: string;
  flywheelRunId?: string;
  /** 1-based registered slot index for per-item work-agent spawning. */
  slotIndex?: number;
  /** vBRIEF item id assigned to this registered slot. Required with slotIndex. */
  slotItemId?: string;
  /** Optional per-spawn cap for registered work-agent slots. Defaults to the work-agent governor cap. */
  maxRegisteredSlots?: number;
}

export interface RegisteredSlotSpawn {
  agentId: string;
  branch: string;
  workspace: string;
  slotIndex: number;
  slotItemId: string;
}

export function resolveRegisteredSlotSpawn(
  issueId: string,
  baseWorkspace: string,
  options: Pick<SpawnRunOptions, 'slotIndex' | 'slotItemId'>,
): RegisteredSlotSpawn | null {
  const { slotIndex, slotItemId: slotItemIdRaw } = options;
  if (slotIndex === undefined && slotItemIdRaw === undefined) return null;
  if (slotIndex === undefined || slotItemIdRaw === undefined) {
    throw new Error('Registered slot spawn requires both slotIndex and slotItemId.');
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 1) {
    throw new Error(`Registered slot index must be a positive integer; got ${slotIndex}.`);
  }
  const slotItemId = slotItemIdRaw.trim();
  if (!slotItemId) {
    throw new Error('Registered slot spawn requires a non-empty slotItemId.');
  }

  const issueLower = issueId.toLowerCase();
  return {
    agentId: `agent-${issueLower}-slot-${slotIndex}`,
    branch: `feature/${issueLower}-slot-${slotIndex}`,
    workspace: `${baseWorkspace}-slot-${slotIndex}`,
    slotIndex,
    slotItemId,
  };
}

export interface SlotTierSpawnParams {
  model?: string;
  harness?: RuntimeName;
  tierName?: string;
}

/**
 * Tiered-execution model resolution for a registered slot spawn (PAN-1791,
 * fixing PAN-1196's "difficulty captured and ignored"). When tiered execution
 * is enabled for the plan, resolve the slot item's tier through
 * assignDispatchTier and return its (model, harness) as spawn params so the
 * dispatched bead runs on the tier its difficulty selected.
 *
 * Returns {} — leaving the existing model resolution untouched — when:
 * - tiered execution is disabled (globally and per-plan), or
 * - an explicit per-spawn model override was passed (same precedence as
 *   determineModel: an explicit override outranks routing), or
 * - the item carries no difficulty and no per-bead model override, in which
 *   case the chain's role-default step IS the existing configured
 *   role-default resolution in determineModel (nothing hardcoded here).
 */
export function resolveSlotTierSpawnParams(
  baseWorkspace: string,
  slotItemId: string,
  explicitModel?: string,
): SlotTierSpawnParams {
  const tiered = loadYamlConfig().config.tieredExecution;
  const doc = readWorkspacePlanSync(baseWorkspace);
  const planMetadata = doc?.plan?.metadata;
  if (!resolveTieredExecutionEnabled(tiered, planMetadata)) return {};
  if (explicitModel) return {};
  if (!doc) {
    throw new Error(
      `Tiered execution is enabled but no vBRIEF plan is readable in ${baseWorkspace}.`,
    );
  }
  const item = doc.plan.items.find((candidate) => candidate.id === slotItemId);
  if (!item) {
    throw new Error(
      `Tiered execution is enabled but item '${slotItemId}' was not found in the plan for ${baseWorkspace}.`,
    );
  }
  if (!item.metadata?.difficulty && !item.metadata?.model) return {};
  const assignment = assignDispatchTier(item, tiered, planMetadata);
  return { model: assignment.model, harness: assignment.harness, tierName: assignment.tierName };
}

/**
 * Shared tracker resolution logic for issue state transitions.
 *
 * Resolution order (by project tracker type):
 * 1. github_repo → GitHub Issues (takes priority over issue_prefix, since projects
 *    like overdeck use GitHub Issues with a prefix, not Linear)
 * 2. rally_project → Rally
 * 3. issue_prefix (no github_repo) → Linear (covers gitlab+linear and pure-linear projects)
 * 4. gitlab_repo only → warn and skip (GitLab doesn't support label-based state transitions)
 *
 * Precedence rationale: issue_prefix was renamed from linear_team but is now also set on
 * GitHub-hosted projects (e.g. issue_prefix: PAN for overdeck GitHub Issues).
 * github_repo must be checked first so GitHub projects don't misroute to Linear.
 */
async function transitionIssueState(issueId: string, state: IssueState, workspacePath?: string): Promise<void> {
  // Guard: bare numeric IDs (no alphabetic prefix, e.g. "484") must never reach
  // any tracker API. Linear's searchIssues("484") would match MIN-484 in the wrong
  // team. Log a warning and skip — the workspace's project must use prefixed IDs.
  if (/^\d+$/.test(issueId)) {
    console.warn(
      `[agents] Skipping ${state} transition for bare numeric ID "${issueId}" — ` +
      `issue IDs must include a project prefix (e.g. PAN-${issueId}). ` +
      `This workspace was likely created before the pan- prefix convention.`
    );
    return;
  }

  // Resolve the project from workspacePath — its configured tracker is authoritative.
  // Every issue MUST belong to a registered project with a tracker configured.
  const projectConfig = workspacePath ? findProjectByPathSync(workspacePath) : null;
  if (!projectConfig) {
    throw new Error(`Cannot transition ${issueId}: no project config found for workspace ${workspacePath || '(none)'}. Register the project in projects.yaml.`);
  }

  // Project has a GitHub repo — use GitHub Issues tracker.
  // Checked BEFORE issue_prefix because github_repo projects (e.g. overdeck)
  // set issue_prefix for their GitHub Issue prefix (PAN-), not for Linear.
  if (projectConfig.github_repo) {
    const [owner, repo] = projectConfig.github_repo.split('/');
    const tracker = createTracker({ type: 'github', owner, repo });
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via GitHub (${projectConfig.github_repo})`);
    return;
  }

  // Project has a Rally project — use Rally tracker
  if (projectConfig.rally_project) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.rally) {
      throw new Error(`Project ${projectConfig.name} uses Rally (project: ${projectConfig.rally_project}) but no Rally tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'rally');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Rally (project: ${projectConfig.rally_project})`);
    return;
  }

  // Project has a Linear team prefix (and no github_repo) — use Linear tracker.
  // This covers: pure-Linear projects and gitlab+Linear projects (e.g. mind-your-now).
  if (getIssuePrefix(projectConfig)) {
    const config = loadConfigSync();
    const trackersConfig = config.trackers;
    if (!trackersConfig?.linear) {
      throw new Error(`Project ${projectConfig.name} uses Linear (team: ${getIssuePrefix(projectConfig)}) but no Linear tracker is configured in config.yaml`);
    }
    const tracker = createTrackerFromConfig(trackersConfig, 'linear');
    await Effect.runPromise(tracker.transitionIssue(issueId, state));
    console.log(`[agents] Transitioned ${issueId} to ${state} via Linear (team: ${getIssuePrefix(projectConfig)})`);
    return;
  }

  if (projectConfig.gitlab_repo) {
    console.warn(`[agents] GitLab project detected (${projectConfig.gitlab_repo}) but GitLab does not support ${state} label transitions`);
    return;
  }

  throw new Error(`Project ${projectConfig.name} has no tracker configured (need issue_prefix, github_repo, or rally_project in projects.yaml)`);
}

export async function transitionIssueToInProgress(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_progress', workspacePath);
}

/**
 * Transitions an issue to "in_review" state in the configured issue tracker.
 * Fire-and-forget — logs warnings on failure but never blocks the pipeline.
 */
export async function transitionIssueToInReview(issueId: string, workspacePath?: string): Promise<void> {
  return transitionIssueState(issueId, 'in_review', workspacePath);
}

export interface AgentLaunchConfig {
  launcherContent: string;
  providerEnv: Record<string, string>;
}

export async function buildAgentLaunchConfig(opts: {
  agentId: string;
  model: string;
  workspace: string;
  role: Role;
  spawnMode?: 'resume';
  resumeSessionId?: string;
  isPlanning?: boolean;
  /** Per-agent .mcp.json path for the experimental Channels bridge. */
  channelsBridgeMcpConfig?: string;
  /** MCP server name to load as a Channel; defaults to 'overdeck-bridge'. */
  channelsBridgeServerName?: string;
  useSupervisor?: boolean;
  supervisorScriptPath?: string;
  /** Claude Code session id for fresh launches that need a known id before boot. */
  sessionId?: string;
  /**
   * Coding-agent harness (PAN-636). Defaults to 'claude-code' when omitted —
   * preserves bit-for-bit pre-PAN-636 behavior. When 'pi', the launcher is
   * built via the Pi command-line generator instead of the claude path; opts
   * like agentId-as-name and agent-frontmatter are ignored because Pi has
   * no agent-definition system.
   */
  harness?: RuntimeName;
  extraEnvExports?: string[];
  /** Claude Code `--effort` level threaded into the launcher command. */
  effort?: RoleEffort;
  /** Inline prompt to embed in launch commands that still support prompt arguments. */
  promptInline?: string;
}): Promise<AgentLaunchConfig> {
  const model = requireModelOverrideSync(opts.model);

  // Substrate guard: inject permission deny rules for Overdeck infrastructure
  // paths (.claude/agents/, .claude/hooks/, ~/.overdeck/, JSONL session dirs)
  // into the workspace's .claude/settings.local.json. Idempotent. Without this
  // a vBRIEF action like "delete the legacy pan-*-agent.md files" can convince
  // an agent to brick its own runtime. PAN-1048 X1 incident, 2026-05-09.
  try {
    const { injectOverdeckInfraDeny } = await import('../claude-settings-overlay.js');
    await Effect.runPromise(injectOverdeckInfraDeny(opts.workspace));
  } catch (err) {
    console.warn(`[agents] injectOverdeckInfraDeny failed for ${opts.agentId} (non-fatal): ${err instanceof Error ? err.message : err}`);
  }

  const providerEnv = await getProviderEnvForModel(model);

  const provider = getProviderForModelSync(model as ModelId);
  if (provider.authType === 'credential-file') {
    setupCredentialFileAuthSync(provider, opts.workspace);
  } else {
    clearCredentialFileAuthSync(opts.workspace);
  }

  const providerExports = await getProviderExportsForModel(model);

  // PAN-1048: resume/restart launchers must respect the agent's role.
  // A resumed review/test/ship run loads the wrong frontmatter (and wrong
  // tool permissions) if it always points at roles/work.md.
  const launchRole: Role = opts.isPlanning ? 'plan' : opts.role;

  // PAN-1055: ohmypi harness needs --session-dir + fifo redirect threaded into
  // the launcher; getOhmypiLauncherFields() resolves them from the agent state
  // and they're spread into generateLauncherScript() below.
  // PAN-1574: codex harness needs its per-agent CODEX_HOME path.
  const behavior = getHarnessBehavior(opts.harness);
  const piLauncherFields = behavior.usesRpcFifo
    ? await getOhmypiLauncherFields(opts.agentId, model)
    : {};
  const codexLauncherFields = behavior.usesCodexHome
    ? getCodexLauncherFields(opts.agentId, model, opts.workspace)
    : {};

  if (opts.spawnMode === 'resume' && opts.resumeSessionId) {
    // Resume sessions adopt the role definition via --agent.
    // Permissions/model/tools/hooks come from roles/<role>.md frontmatter.
    // --name <agentId> gives the resumed Claude session a human-readable handle.
    //
    // The frontmatter's permissionMode: bypassPermissions only bypasses prompts
    // INSIDE cwd. Tools that touch siblings of cwd (e.g. bd reading
    // .beads/issues.jsonl through git subprocesses, pan reading
    // ~/.overdeck/...) still hit "Do you want to proceed?" without DSP.
    // Mid-Bash dialog dismissals (deacon nudge, paste-buffer write, sibling
    // hook output) cancel the in-flight tool call and surface as
    // `Interrupted · What should Claude do instead?` (PAN-1024 reproduced
    // this loop on every fresh resume of PAN-1044/PAN-934).
    //
    // Match the fresh-spawn path: when permissionMode resolves to 'bypass'
    // (PAN_YOLO=true OR claude.permissionMode=bypass in config), prepend
    // --dangerously-skip-permissions on resume too.
    // Use the shared helper so the only string literal for DSP lives in
    // claude-permissions.ts (see scripts/lint-permissions.sh allowlist).
    const launcherContent = generateLauncherScriptSync({
      role: launchRole,
      spawnMode: 'resume',
      workingDir: opts.workspace,
      changeDir: false,
      setTerminalEnv: true,
      providerExports,
      // PAN-2087: claude-code resumes inject the role body (+ effort) as an
      // appended system prompt instead of `--agent <file>` (Claude Code 2.1.195
      // dropped --agent file support); permission flags come from the global
      // resolver. ohmypi/codex resumes route through getAgentRuntimeBaseCommand
      // which short-circuits to the omp/codex form.
      baseCommand: behavior.launchCommandKind !== 'claude-code'
        ? await getAgentRuntimeBaseCommand(model, opts.agentId, launchRole, opts.harness)
        : `claude ${getClaudePermissionFlagsStringSync()}${roleSystemPromptInjectionSync(roleAgentDefinitionPath(launchRole))}`,
      resumeSessionId: opts.resumeSessionId,
      model: behavior.launchCommandKind !== 'claude-code' || providerExports.includes('ANTHROPIC_BASE_URL') ? model : undefined,
      extraArgs: behavior.launchCommandKind !== 'claude-code' ? undefined : `--name ${opts.agentId}`,
      appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
      extraEnvExports: opts.extraEnvExports,
      useSupervisor: opts.useSupervisor,
      supervisorScriptPath: opts.supervisorScriptPath,
      promptInline: opts.promptInline,
      ...piLauncherFields,
      ...codexLauncherFields,
    });
    return { launcherContent, providerEnv };
  }

  const yamlConfig = loadYamlConfig();
  const cavemanExports = await buildCavemanExports(
    opts.workspace,
    yamlConfig.config.caveman,
    opts.isPlanning ?? false,
  );

  // PAN-982: pass the role definition path + agentId through getAgentRuntimeBaseCommand so it
  // emits 'claude --agent roles/<role>.md --name <agentId>'.
  // PAN-636: when the harness uses the ohmypi RPC command, the helper
  // short-circuits to an omp --mode rpc line and the
  // agentName/agentDefinition arguments are ignored (Pi has no agent
  // definitions). The launcher generator's Pi branch then layers --session-dir
  // and the fifo redirect on top.
  const agentDefinition = roleAgentDefinitionPath(launchRole);
  const launcherContent = generateLauncherScriptSync({
    role: launchRole,
    workingDir: opts.workspace,
    changeDir: false,
    setTerminalEnv: true,
    providerExports,
    cavemanExports,
    baseCommand: await getAgentRuntimeBaseCommand(model, opts.agentId, agentDefinition, opts.harness ?? 'claude-code', opts.effort),
    sessionId: behavior.sessionIdSource === 'launcher-session-id' ? opts.sessionId : undefined,
    appendSystemPromptFiles: await claudeSystemPromptFiles(opts.workspace, opts.harness),
    extraEnvExports: opts.extraEnvExports,
    useSupervisor: opts.useSupervisor,
    supervisorScriptPath: opts.supervisorScriptPath,
    promptInline: opts.promptInline,
    ...piLauncherFields,
    ...codexLauncherFields,
    ...(opts.channelsBridgeMcpConfig
      ? {
          channelsBridgeMcpConfig: opts.channelsBridgeMcpConfig,
          channelsBridgeServerName: opts.channelsBridgeServerName ?? 'overdeck-bridge',
        }
      : {}),
  });

  return { launcherContent, providerEnv };
}

export function defaultRunWorkspace(issueId: string): string {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) {
    throw new Error(`Cannot spawn role run for ${issueId}: no project is configured for this issue prefix`);
  }
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

export async function retrieveSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  if (!input.prompt.trim()) return '';

  try {
    const identity: MemoryIdentity = {
      projectId: inferMemoryProjectId(input.workspace),
      workspaceId: basename(input.workspace),
      issueId: input.issueId,
      runId: input.agentId,
      sessionId: input.agentId,
      agentRole: input.role,
      agentHarness: input.harness,
    };
    const { injectPromptTimeMemory } = await import('../memory/injection.js');
    return (await injectPromptTimeMemory({ prompt: input.prompt, identity, surface: 'spawn' })).context;
  } catch (error) {
    console.warn(`[agents] Spawn-time memory context unavailable for ${input.agentId}:`, error instanceof Error ? error.message : String(error));
    return '';
  }
}

export async function withSpawnTimeMemoryContext(input: {
  prompt: string;
  issueId: string;
  workspace: string;
  agentId: string;
  role: Role;
  harness: RuntimeName;
}): Promise<string> {
  const context = await retrieveSpawnTimeMemoryContext(input);
  return context ? `${context}\n\n---\n\n${input.prompt}` : input.prompt;
}

export function runAgentId(issueId: string, role: Role, subRole?: string): string {
  const base = role === 'work'
    ? `agent-${issueId.toLowerCase()}`
    : `agent-${issueId.toLowerCase()}-${role}`;
  return subRole ? `${base}-${subRole}` : base;
}

/**
 * Spawn-time stack-rebuild self-heal state. PAN-1618: the work-spawn gate
 * (`assertWorkspaceStackHealthyForSpawn`) used to fail hard when the workspace
 * docker stack was down, with only manual recoveries (`pan workspace rebuild`
 * or interactive `--host`). Under autonomous operation a fully-planned
 * `proposed` item whose stack happened to be down could never auto-start its
 * work agent — it sat at the gate forever. This mirrors the PAN-1247
 * orphan-test self-heal one role earlier: rebuild the stack before failing,
 * bounded by a cooldown + attempt cap so a stack that genuinely cannot be
 * rebuilt escalates to a human instead of looping `docker compose` forever.
 */
const spawnStackRebuildState: Map<string, { lastAttempt: number; attempts: number; escalated: boolean; hostFallbackNoticed?: boolean }> =
  new Map();
const SPAWN_STACK_REBUILD_COOLDOWN_MS = 15 * 60 * 1000;
const SPAWN_STACK_REBUILD_MAX_ATTEMPTS = 3;

/**
 * Spawn a role-based Overdeck run. Work delegates to the existing work-agent
 * path; review/test/ship use the role definition files under roles/.
 */
export async function assertWorkspaceStackHealthyForSpawn(
  issueId: string,
  role: Role,
  allowHost = false,
  workspacePath?: string,
): Promise<void> {
  if (role === 'plan') return;

  // PAN-1872: guard against an undefined issueId so workspace health checks do
  // not crash with `Cannot read properties of undefined (reading 'toUpperCase')`
  // while pan start is recovering from a sync-main conflict.
  const normalizedIssue = (issueId ?? '').toUpperCase();

  // PAN-1746: absence of a workspace must be a HARDER failure than an unhealthy
  // one. The host-fallback path below lets advancing roles (review/test/ship)
  // proceed when the docker stack is merely unhealthy — but a workspace
  // directory that does not exist at all means the launcher would fall back to
  // its cwd ($HOME) and wedge Claude at the folder-trust prompt while it holds
  // an advancing slot against the PAN-1665 governor. Refuse the spawn outright
  // instead of degrading to host. (`work`'s resume path already guards this in
  // restartAgent; this closes the same gap on the role-run spawn path.)
  if (workspacePath && !existsSync(workspacePath)) {
    throw new Error(
      `Workspace for ${normalizedIssue} does not exist at ${workspacePath} — refusing to spawn ${role}. `
      + `A missing workspace would land the agent in $HOME at the folder-trust prompt. `
      + `Recreate the workspace ('pan workspace rebuild ${normalizedIssue}') before retrying.`,
    );
  }

  const health = await Effect.runPromise(getWorkspaceStackHealth(issueId, { workspacePath }));
  if (health.healthy) {
    spawnStackRebuildState.delete(normalizedIssue);
    return;
  }

  const details = health.reasons.join('; ');
  const message = `Workspace docker stack for ${normalizedIssue} is not healthy: ${details}. Run 'pan workspace rebuild ${normalizedIssue}' or retry with --host to override.`;

  if (allowHost) {
    // PAN-1556: host-override is a per-spawn detail, not user-facing activity —
    // it fired once per convoy member and buried real feed items (conversations).
    // Keep the console.warn for debugging; do not emit to the session feed.
    console.warn(`[agents] ${message}`);
    return;
  }

  // PAN-1645 + PAN-1618: an unhealthy stack must NEVER *block* the advancing
  // roles. review/test/ship all operate on the HOST workspace — ship
  // rebases/pushes against the host .git, review reads the committed diff, and
  // test runs the project's quality gates (host-run unless a gate explicitly
  // opts into a container) — so they do not need the workspace's docker
  // containers at all. The long-standing manual `--host` workaround (PAN-1645)
  // burned enormous effort just rediscovering that ship-on-broken-docker is a
  // false gate. For these roles we still attempt one bounded autonomous rebuild
  // (so a project whose test gates DO run in containers gets a healthy stack
  // when recoverable), but if it can't be made healthy we AUTO-FALL-BACK TO
  // HOST and proceed instead of throwing.
  //
  // `work` is different: a work agent may rely on the dev container's services,
  // so silently running it on the host could build/test against a missing
  // environment. work keeps the hard gate (rebuild → escalate to a human).
  const hostFallbackEligible = role !== 'work';

  const record = spawnStackRebuildState.get(normalizedIssue)
    ?? { lastAttempt: 0, attempts: 0, escalated: false };
  const now = Date.now();

  const fallbackToHost = (reason: string): void => {
    console.warn(`[agents] ${message} — auto-falling back to host for ${role} (${reason})`);
    // Emit the host-fallback notice once per issue. Use a SEPARATE latch from
    // the work-escalation latch (`escalated`): if review/test/ship trip the
    // host fallback first, a later `work` spawn for the same broken-stack issue
    // must still be able to emit its own (error-level) dead-end marker — the
    // operator's only signal that a work agent is blocked on docker.
    if (!record.hostFallbackNoticed) {
      record.hostFallbackNoticed = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'warn',
        issueId: normalizedIssue,
        message: `agent-spawn-host-fallback: ${normalizedIssue}`,
        details: `Workspace docker stack unhealthy (${details}); ${role} runs on the host (rebase/verify use host .git + host gates), so proceeding without containers. ${reason}`,
      });
    }
  };

  const blockWork = (markerMessage: string, errDetails: string): never => {
    if (!record.escalated) {
      record.escalated = true;
      spawnStackRebuildState.set(normalizedIssue, record);
      emitActivityEntrySync({
        source: role,
        level: 'error',
        issueId: normalizedIssue,
        message: markerMessage,
        details: errDetails,
      });
    }
    throw new Error(message);
  };

  if (record.attempts >= SPAWN_STACK_REBUILD_MAX_ATTEMPTS) {
    if (hostFallbackEligible) {
      fallbackToHost(`rebuild exhausted after ${record.attempts} attempts`);
      return;
    }
    blockWork(
      `agent-spawn-stack-rebuild-exhausted: ${normalizedIssue}`,
      `Workspace docker stack still unhealthy after ${record.attempts} rebuild attempts: ${details}. Manual 'pan workspace rebuild ${normalizedIssue}' or retry with --host needed.`,
    );
  }

  if (now - record.lastAttempt < SPAWN_STACK_REBUILD_COOLDOWN_MS) {
    // A rebuild was attempted recently and the stack is still unhealthy —
    // don't hammer `docker compose` every spawn.
    if (hostFallbackEligible) {
      fallbackToHost('rebuild on cooldown');
      return;
    }
    blockWork(`agent-spawn-blocked-stack-unhealthy: ${normalizedIssue}`, details);
  }

  record.lastAttempt = now;
  record.attempts += 1;
  spawnStackRebuildState.set(normalizedIssue, record);
  console.log(
    `[agents] Workspace stack for ${normalizedIssue} unhealthy (${details}) — rebuilding ` +
      `before spawn (attempt ${record.attempts}/${SPAWN_STACK_REBUILD_MAX_ATTEMPTS})`,
  );

  const { rebuildWorkspaceStack } = await import('../workspace/rebuild-stack.js');
  const result = await Effect.runPromise(
    rebuildWorkspaceStack(issueId, {
      onProgress: (m) => console.log(`[agents]   ${normalizedIssue} stack rebuild: ${m}`),
    }),
  ).catch((err: unknown) => ({ success: false as const, error: err instanceof Error ? err.message : String(err) }));

  if (result.success) {
    spawnStackRebuildState.delete(normalizedIssue);
    console.log(`[agents] Workspace stack for ${normalizedIssue} rebuilt — proceeding with spawn`);
    return;
  }

  console.warn(`[agents] Workspace stack rebuild failed for ${normalizedIssue}: ${result.error}`);
  if (hostFallbackEligible) {
    fallbackToHost(`rebuild failed: ${result.error ?? 'unknown'}`);
    return;
  }
  blockWork(`agent-spawn-stack-rebuild-failed: ${normalizedIssue}`, result.error ?? details);
}
