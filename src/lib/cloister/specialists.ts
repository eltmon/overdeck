/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID, createHash } from 'crypto';
import { AGENTS_DIR, PANOPTICON_HOME } from '../paths.js';
import { getDevrootPath } from '../config.js';
import { getClaudePermissionFlagsString } from '../claude-permissions.js';
import { getProject } from '../projects.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';
import { createSpecialistHandoff, logSpecialistHandoff } from './specialist-handoff-logger.js';
import type { ModelId } from '../settings.js';
import { loadCloisterConfig } from './config.js';
import { readCavemanVariant } from '../caveman/workspace.js';
import { getProviderForModel, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import { getProviderEnvForModel } from '../agents.js';
import { generateLauncherScript, generateLauncherWrapper } from '../launcher-generator.js';
import { getSpecialistHarness } from './router.js';
import { sendKeysAsync, capturePaneAsync, waitForClaudePrompt, confirmDelivery, createSessionAsync, killSessionAsync, buildTmuxCommandString, listPaneValuesAsync, listSessionNamesAsync, sessionExistsAsync } from '../tmux.js';
import { notifyPipeline } from '../pipeline-notifier.js';
import { isTaskReady } from './task-readiness.js';
import { renderPrompt } from './prompts.js';

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
 * may have leaked into its child sessions. The panopticon tmux server is long-lived
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


async function buildSpecialistBaseCommand(
  specialistType: string,
  model: string,
  sessionName?: string,
): Promise<string> {
  const { canUseHarness } = await import('../harness-policy.js');
  const { getAgentRuntimeBaseCommand, getProviderAuthMode } = await import('../agents.js');
  const requestedHarness = getSpecialistHarness(specialistType);
  const authMode = await getProviderAuthMode(model);
  const decision = canUseHarness(requestedHarness, model, authMode);
  const harness = decision.allowed ? requestedHarness : 'claude-code';
  if (!decision.allowed) {
    console.warn(
      `[specialist] ${specialistType}: canUseHarness(${requestedHarness},${model},${authMode}) blocked — ${decision.reason}. Falling back to claude-code.`,
    );
  }
  const agentDefinition = specialistType.startsWith('pan-')
    ? specialistType
    : `pan-${specialistType.endsWith('-agent')
      ? specialistType.slice(0, -'-agent'.length)
      : specialistType}-agent`;
  return getAgentRuntimeBaseCommand(model, sessionName, agentDefinition, harness);
}

function readRecordedClaudeSessionId(tmuxSession: string): string | null {
  const sessionFile = join(AGENTS_DIR, tmuxSession, 'session.id');
  if (!existsSync(sessionFile)) return null;
  try {
    const sessionId = readFileSync(sessionFile, 'utf-8').trim();
    return sessionId || null;
  } catch {
    return null;
  }
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
  const variant = workspacePath ? await readCavemanVariant(workspacePath) : 'off';
  if (variant === 'off') return '';
  if (variant === 'disabled') {
    return `export PANOPTICON_CAVEMAN_VARIANT="${variant}"\n`;
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

  return `export CAVEMAN_DEFAULT_MODE="${mode}"\nexport PANOPTICON_CAVEMAN_VARIANT="${variant}"\n`;
}

const SPECIALISTS_DIR = join(PANOPTICON_HOME, 'specialists');
const REGISTRY_FILE = join(SPECIALISTS_DIR, 'registry.json');

const SPECIALIST_AGENT_NAMES = ['merge-agent', 'review-agent', 'test-agent', 'inspect-agent', 'uat-agent'] as const;
export type SpecialistAgentName = typeof SPECIALIST_AGENT_NAMES[number];

type SpecialistLifecycleState = 'sleeping' | 'active' | 'uninitialized';

export interface LegacySpecialistDefinition {
  name: SpecialistAgentName;
  displayName: string;
  description: string;
  enabled: boolean;
  autoWake: boolean;
  sessionId?: string;
  lastWake?: string; // ISO 8601 timestamp
  contextTokens?: number;
}

export interface LegacySpecialistRuntimeStatus extends LegacySpecialistDefinition {
  state: SpecialistLifecycleState;
  isRunning: boolean;
  tmuxSession?: string;
  currentIssue?: string; // Issue ID currently being worked on
}

/**
 * One step in the model resolution trace (PAN-754)
 */
export interface ResolutionStep {
  source: 'explicit-param' | 'role-config' | 'cloister-config' | 'fallback';
  workTypeId?: string;
  configKey?: string;
  resolvedAlias?: string;
  resolvedModel: string;
  matched: boolean;
}

/**
 * Per-project specialist metadata
 */
export interface ProjectSpecialistMetadata {
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
  currentRun: string | null; // Run ID if active
  sessionId?: string; // Legacy session ID for transition period
  // Identity fields (PAN-754)
  issueId?: string;
  tmuxSession?: string; // Stored at spawn time so we can look it up without recomputing
  role?: string; // For convoy members: 'correctness' | 'performance' | etc.
  // Activity visibility (PAN-754)
  currentActivity?: string | null;
  model?: string | null;
  resolutionTrace?: ResolutionStep[] | null;
  // Write-scope (PAN-754)
  writeScope?: 'full' | 'readonly-plus-output';
  outputPath?: string | null;
  workspace?: string | null; // workspace path for write-scope conflict detection
}

export function isProjectSpecialistActivelyRunning(
  runtimeState?: { state?: 'active' | 'idle' | 'suspended' | 'stopped' | 'uninitialized' | 'waiting-on-human' } | null,
  fallbackRunning: boolean = false
): boolean {
  if (runtimeState?.state === 'active') return true;
  if (
    runtimeState?.state === 'idle'
    || runtimeState?.state === 'suspended'
    || runtimeState?.state === 'stopped'
    || runtimeState?.state === 'waiting-on-human'
  ) {
    return false;
  }
  return fallbackRunning;
}

/**
 * Registry of all specialist agents (per-project structure)
 */
export interface SpecialistRegistry {
  version: string;
  // Global defaults for specialist configuration
  defaults: {
    contextRuns: number;
    digestModel: string | null;
    retention: { maxDays: number; maxRuns: number };
  };
  // Per-project specialist metadata
  projects: {
    [projectKey: string]: {
      [specialistType: string]: ProjectSpecialistMetadata;
    };
  };
  // Legacy: Global specialists list (for backward compatibility)
  specialists?: LegacySpecialistDefinition[];
  lastUpdated: string; // ISO 8601 timestamp
}

/**
 * PAN-1048 review feedback 003 (REQ-16): default specialist definitions are
 * gone. The role primitive replaces the specialist identity model, so
 * recreating registry.json with a hard-coded list of specialist names would
 * just resurrect what startup cleanup just deleted.
 */
const DEFAULT_SPECIALISTS: LegacySpecialistDefinition[] = [];

/**
 * PAN-1048 review feedback 003 (REQ-16): initSpecialistsDirectory is a no-op.
 *
 * The cleanup at Cloister startup (service.ts cleanupLegacySpecialistsDirectory)
 * removes ~/.panopticon/specialists/ on every boot. The previous body of this
 * function would unconditionally re-create the directory and seed
 * registry.json from DEFAULT_SPECIALISTS the next time anything called
 * loadRegistry(), undoing the cleanup and resurrecting the legacy identity
 * model. The stub keeps the call sites alive (callers that still loadRegistry
 * get an in-memory default registry) without recreating any disk artifacts.
 */
export function initSpecialistsDirectory(): void {
  // Intentionally empty. See block comment above.
}

/**
 * Migrate old registry format to new per-project structure (PAN-754: compound-key aware).
 *
 * v1.0 → v2.0: flat specialist list → projects[projectKey][specialistType]
 * v2.0 → v3.0: projects[projectKey][specialistType] → projects[projectKey][compoundKey]
 *   Legacy v2.0 plain-type keys are left as-is (still readable by compat wrappers).
 *   getProjectSpecialistMetadata() and updateProjectSpecialistMetadata() handle both formats.
 */
function migrateRegistryIfNeeded(): void {
  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(content) as SpecialistRegistry;

    // v2.0 already migrated (or registry.projects exists for fresh installs)
    if (registry.version === '2.0' && registry.projects) {
      // No additional migration needed — legacy plain-type keys are handled by compat wrappers.
      return;
    }

    if (!registry.projects) {
      // v1.0 → v2.0: add projects map
      console.log('[specialists] Migrating registry v1.0 → v2.0...');

      const migratedRegistry: SpecialistRegistry = {
        version: '2.0',
        defaults: {
          contextRuns: 5,
          digestModel: null,
          retention: {
            maxDays: 30,
            maxRuns: 50,
          },
        },
        projects: {},
        specialists: registry.specialists,
        lastUpdated: new Date().toISOString(),
      };

      saveRegistry(migratedRegistry);
      console.log('[specialists] Registry migration v1.0 → v2.0 complete');
    }
  } catch (error) {
    console.error('[specialists] Failed to migrate registry:', error);
  }
}

/**
 * Load the specialist registry
 *
 * @returns Specialist registry
 */
export function loadRegistry(): SpecialistRegistry {
  // PAN-1048 review feedback 003 (REQ-16): do not recreate the directory.
  // If registry.json is missing (typical after Cloister startup cleanup),
  // return an empty in-memory registry instead of seeding disk.
  if (!existsSync(REGISTRY_FILE)) {
    return {
      version: '3.0',
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: { maxDays: 30, maxRuns: 50 },
      },
      projects: {},
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
  }
  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load specialist registry:', error);
    return {
      version: '3.0',
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: { maxDays: 30, maxRuns: 50 },
      },
      projects: {},
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save the specialist registry
 *
 * @param registry - Registry to save
 */
export function saveRegistry(registry: SpecialistRegistry): void {
  // PAN-1048 review feedback 003 (REQ-16): only persist when the legacy
  // directory already exists. Cloister startup cleanup deletes the directory
  // on every boot, so writing here without a pre-existing dir would re-create
  // the legacy identity model that the cleanup is meant to remove. The
  // in-memory registry from loadRegistry() is enough for the few residual
  // call sites that still consult specialist metadata.
  if (!existsSync(SPECIALISTS_DIR)) {
    return;
  }

  registry.lastUpdated = new Date().toISOString();

  try {
    const content = JSON.stringify(registry, null, 2);
    writeFileSync(REGISTRY_FILE, content, 'utf-8');
  } catch (error) {
    console.error('Failed to save specialist registry:', error);
    throw error;
  }
}

/**
 * Generate a deterministic UUID from a string.
 * Uses SHA-256 hash formatted as a UUID v4-compatible string.
 * This ensures the same specialist+project always gets the same session ID
 * while satisfying Claude Code's UUID format requirement.
 */
function deterministicUUID(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Get metadata for a specific specialist
 *
 * @param name - Specialist name
 * @returns Specialist metadata or null if not found
 */
export function getSpecialistMetadata(name: SpecialistAgentName): LegacySpecialistDefinition | null {
  const registry = loadRegistry();
  return (registry.specialists ?? []).find((s) => s.name === name) || null;
}

/**
 * Update specialist metadata
 *
 * @param name - Specialist name
 * @param updates - Partial metadata to update
 */
export function updateSpecialistMetadata(
  name: SpecialistAgentName,
  updates: Partial<LegacySpecialistDefinition>
): void {
  const registry = loadRegistry();

  const specialists = registry.specialists ?? [];
  const index = specialists.findIndex((s) => s.name === name);

  if (index === -1) {
    throw new Error(`Specialist ${name} not found in registry`);
  }

  specialists[index] = {
    ...specialists[index],
    ...updates,
    name, // Ensure name doesn't change
  };
  registry.specialists = specialists;

  saveRegistry(registry);
}

/**
 * Get all specialist metadata
 *
 * @returns Array of all specialists
 */
export function getAllSpecialists(): LegacySpecialistDefinition[] {
  const registry = loadRegistry();
  return registry.specialists ?? [];
}

/**
 * Check if a legacy specialist has a recorded Claude session.
 *
 * @param name - Specialist name
 * @returns True if the specialist has a recorded session id in its agent directory
 */
export function isInitialized(name: SpecialistAgentName): boolean {
  return readRecordedClaudeSessionId(getTmuxSessionName(name)) !== null;
}

/**
 * Get the state of a specialist from recorded agent metadata.
 *
 * Note: This only checks whether a recorded Claude session exists, not if it's actually running.
 * Use getSpecialistStatus() for runtime state.
 *
 * @param name - Specialist name
 * @returns Specialist state
 */
export function getSpecialistState(name: SpecialistAgentName): Exclude<SpecialistLifecycleState, 'active'> {
  return isInitialized(name) ? 'sleeping' : 'uninitialized';
}

/**
 * Get tmux session name for a specialist
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Expected tmux session name
 */
export function getTmuxSessionName(name: SpecialistAgentName, projectKey?: string, issueId?: string): string {
  if (projectKey && issueId) {
    return `specialist-${projectKey}-${issueId}-${name}`;
  }
  if (projectKey) {
    return `specialist-${projectKey}-${name}`;
  }
  // Legacy format for backward compatibility
  return `specialist-${name}`;
}

/**
 * The five canonical reviewer roles plus synthesis. One tmux session per role
 * per issue, alive for the lifetime of the issue across all review rounds.
 */
export type ReviewerRole =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'requirements'
  | 'synthesis';

export const REVIEWER_ROLES: readonly ReviewerRole[] = [
  'correctness',
  'security',
  'performance',
  'requirements',
  'synthesis',
] as const;

/**
 * Get the canonical reviewer tmux session name (PAN-830 / PAN-1048).
 *
 * Pattern: `agent-<issueId>-review-<role>`. One tmux session per role per
 * issue — sessions are reused across review rounds via `sendKeysAsync`
 * resumption. Round 2 of `review-correctness` does NOT spawn a new session;
 * it injects a follow-up prompt into the existing pane.
 *
 * @param role - One of the canonical reviewer roles
 * @param _projectKey - Unused (kept for signature compatibility with existing callers)
 * @param issueId - Issue identifier (e.g. `pan-540` or `PAN-540`)
 * @returns Canonical tmux session name
 */
export function getReviewerSessionName(
  role: ReviewerRole,
  _projectKey: string,
  issueId: string,
): string {
  return `agent-${issueId.toLowerCase()}-review-${role}`;
}

/**
 * Parse a canonical reviewer session name back into role + issue.
 * Returns null if the name does not match either pattern.
 * Supports both current `agent-*` format and legacy `specialist-*` format.
 */
export function parseReviewerSessionName(name: string): {
  role: ReviewerRole;
  issueId: string;
} | null {
  // Current PAN-1048+ pattern: agent-<issueId>-review-<role>
  const agentMatch = name.match(/^agent-([a-z0-9]+-\d+)-review-(correctness|security|performance|requirements|synthesis)$/i);
  if (agentMatch) {
    return { issueId: agentMatch[1]!.toUpperCase(), role: agentMatch[2] as ReviewerRole };
  }
  // Legacy PAN-830 pattern: specialist-<projectKey>-<issueId>-review-<role>
  const legacyMatch = name.match(/^specialist-([\w.-]+?)-([\w.-]+?)-review-(correctness|security|performance|requirements|synthesis)$/);
  if (legacyMatch) {
    return { issueId: legacyMatch[2], role: legacyMatch[3] as ReviewerRole };
  }
  return null;
}

/**
 * Construct the compound registry key for a per-issue specialist (PAN-754).
 * Format: `${specialistType}:${issueId}` or `${specialistType}:${issueId}:${role}` for convoy.
 */
export function makeSpecialistRegistryKey(specialistType: string, issueId: string, role?: string): string {
  return role ? `${specialistType}:${issueId}:${role}` : `${specialistType}:${issueId}`;
}

/**
 * Remove every project-specialist registry entry whose compound key references
 * the given issueId (case-insensitive match on the second segment). Returns
 * the number of entries removed. Called from teardown so closed issues do not
 * leave behind metadata that the deacon keeps inspecting and force-killing.
 */
export function pruneSpecialistRegistryEntriesForIssue(issueId: string): number {
  const issueLower = issueId.toLowerCase();
  const issueUpper = issueId.toUpperCase();
  const registry = loadRegistry();
  let removed = 0;
  for (const projectKey of Object.keys(registry.projects ?? {})) {
    const bucket = registry.projects![projectKey] ?? {};
    for (const key of Object.keys(bucket)) {
      const { issueId: keyIssue } = parseSpecialistRegistryKey(key);
      if (!keyIssue) continue;
      if (keyIssue === issueLower || keyIssue === issueUpper) {
        delete bucket[key];
        removed++;
      }
    }
  }
  if (removed > 0) {
    saveRegistry(registry);
  }
  return removed;
}

/**
 * Parse a compound registry key back into its parts.
 */
export function parseSpecialistRegistryKey(key: string): { specialistType: string; issueId?: string; role?: string } {
  const parts = key.split(':');
  if (parts.length === 1) return { specialistType: parts[0] };
  if (parts.length === 2) return { specialistType: parts[0], issueId: parts[1] };
  return { specialistType: parts[0], issueId: parts[1], role: parts[2] };
}

/**
 * Record wake event in metadata
 *
 * @param name - Specialist name
 * @param sessionId - New session ID (if changed)
 */
export function recordWake(name: SpecialistAgentName, sessionId?: string): void {
  const updates: Partial<LegacySpecialistDefinition> = {
    lastWake: new Date().toISOString(),
  };

  if (sessionId) {
    updates.sessionId = sessionId;
  }

  updateSpecialistMetadata(name, updates);
}

/**
 * ===========================================================================
 * Ephemeral Lifecycle Management
 * ===========================================================================
 */

/**
 * Grace period state for a specialist
 */
export interface GracePeriodState {
  active: boolean;
  startedAt: string;
  duration: number; // milliseconds
  paused: boolean;
  pausedAt?: string;
  remainingTime?: number; // milliseconds when paused
}

const gracePeriodStates = new Map<string, GracePeriodState>();

/**
 * Task context interface for specialist tasks.
 */
export interface TaskContext {
  prUrl?: string;
  workspace?: string;
  branch?: string;
  filesChanged?: string[];
  reason?: string;
  targetModel?: string;
  additionalInstructions?: string;
  [key: string]: string | string[] | undefined;
}

/**
 * PAN-1048 R1: spawnEphemeralSpecialist removed.
 *
 * The function was the generic dispatcher that took an arbitrary
 * SpecialistAgentName ('review-agent' | 'test-agent' | 'merge-agent' |
 * 'inspect-agent' | …) and shelled out a launcher specific to each. Under
 * the role primitive, those flavours are first-class roles
 * (review/test/ship) plus a single work sub-role (inspect / inspect-deep).
 *
 * Replacements:
 * - Review/test/ship runs: spawnRun(issueId, role, opts) in src/lib/agents.ts.
 *   Reactive Cloister fires these on lifecycle transitions; the manual
 *   re-dispatch in routes/workspaces.ts also uses spawnRun.
 * - Inspect runs: spawnInspectAgent() in cloister/inspect-agent.ts owns
 *   its own minimal launcher path (single-bead-scoped, ephemeral).
 *
 * The specialist registry/run-log/grace-period machinery stays in this
 * file because the dashboard read-model and reset/init/grace endpoints
 * still consume it for legacy run history; nothing writes new entries
 * once the dispatcher is gone.
 */


/**
 * Start grace period for a specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param duration - Grace period duration in milliseconds (default: 60000)
 */
export function startGracePeriod(
  projectKey: string,
  specialistType: SpecialistAgentName,
  duration: number = 60000
): void {
  const key = `${projectKey}-${specialistType}`;

  gracePeriodStates.set(key, {
    active: true,
    startedAt: new Date().toISOString(),
    duration,
    paused: false,
  });

  console.log(`[specialist] Grace period started for ${projectKey}/${specialistType} (${duration}ms)`);

  // Schedule termination after grace period
  setTimeout(() => {
    const state = gracePeriodStates.get(key);
    if (state && state.active && !state.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, duration);
}

/**
 * Pause grace period countdown
 */
export function pauseGracePeriod(projectKey: string, specialistType: SpecialistAgentName): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active) {
    return false;
  }

  const elapsed = Date.now() - new Date(state.startedAt).getTime();
  const remaining = state.duration - elapsed;

  state.paused = true;
  state.pausedAt = new Date().toISOString();
  state.remainingTime = remaining;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period paused for ${projectKey}/${specialistType}`);

  return true;
}

/**
 * Resume grace period countdown
 */
export function resumeGracePeriod(projectKey: string, specialistType: SpecialistAgentName): boolean {
  const key = `${projectKey}-${specialistType}`;
  const state = gracePeriodStates.get(key);

  if (!state || !state.active || !state.paused) {
    return false;
  }

  state.paused = false;
  state.startedAt = new Date().toISOString();
  state.pausedAt = undefined;

  gracePeriodStates.set(key, state);
  console.log(`[specialist] Grace period resumed for ${projectKey}/${specialistType}`);

  // Schedule termination for remaining time
  setTimeout(() => {
    const currentState = gracePeriodStates.get(key);
    if (currentState && currentState.active && !currentState.paused) {
      terminateSpecialist(projectKey, specialistType);
    }
  }, state.remainingTime || 0);

  return true;
}

/**
 * Exit grace period immediately (terminate now)
 */
export function exitGracePeriod(projectKey: string, specialistType: SpecialistAgentName): void {
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  terminateSpecialist(projectKey, specialistType);
}

/**
 * Get grace period state
 */
export function getGracePeriodState(
  projectKey: string,
  specialistType: SpecialistAgentName
): GracePeriodState | null {
  const key = `${projectKey}-${specialistType}`;
  return gracePeriodStates.get(key) || null;
}

/**
 * Find the active registry key for (projectKey, specialistType).
 * Searches compound keys; falls back to plain specialistType key.
 * Returns undefined if nothing is currently active.
 */
export function findActiveRegistryKey(projectKey: string, specialistType: SpecialistAgentName): string | undefined {
  const registry = loadRegistry();
  const bucket = registry.projects[projectKey] ?? {};

  // Check compound keys first (new format: "type:issueId")
  const prefix = `${specialistType}:`;
  const activeCompound = Object.keys(bucket).find(k =>
    k.startsWith(prefix) && bucket[k].currentRun !== null
  );
  if (activeCompound) return activeCompound;

  // Check legacy plain key
  if (bucket[specialistType]?.currentRun !== null) return specialistType;

  // Return most recently touched key even if not active
  const allMatching = Object.keys(bucket).filter(k =>
    k === specialistType || k.startsWith(prefix)
  ).sort((a, b) =>
    (bucket[b].lastRunAt ?? '').localeCompare(bucket[a].lastRunAt ?? '')
  );
  return allMatching[0];
}

/**
 * Signal that a specialist has completed its task
 *
 * This should be called when the specialist finishes its work.
 * It updates the run status and starts the grace period.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param result - Task result
 * @param issueId - Optional: issue being handled (used to compute compound registry key)
 */
export async function signalSpecialistCompletion(
  projectKey: string,
  specialistType: SpecialistAgentName,
  result: {
    status: 'passed' | 'failed' | 'blocked';
    notes?: string;
  },
  issueId?: string
): Promise<void> {
  const registryKey = issueId
    ? makeSpecialistRegistryKey(specialistType, issueId)
    : (findActiveRegistryKey(projectKey, specialistType) ?? specialistType);
  const metadata = getRunMetadata(projectKey, registryKey);

  // Derive tmuxSession: use stored field when available, recompute as fallback
  const resolvedTmuxSession = metadata.tmuxSession ?? getTmuxSessionName(specialistType, projectKey, issueId);

  // Update status
  updateRunStatus(projectKey, registryKey, result.status);

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    try {
      const { finalizeRunLog } = await import('./specialist-logs.js');
      finalizeRunLog(projectKey, specialistType, metadata.currentRun, {
        status: result.status,
        notes: result.notes,
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }
  }

  // Completion means the run itself is over, even if the tmux session stays alive
  // during the grace period for inspection or manual termination.
  setCurrentRun(projectKey, registryKey, null);
  updateRunMetadata(projectKey, registryKey, { currentActivity: null });
  import('../agents.js')
    .then(({ saveAgentRuntimeState }) => {
      saveAgentRuntimeState(resolvedTmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
        currentIssue: undefined,
      });
    })
    .catch((error) => {
      console.error(`[specialist] Failed to mark ${projectKey}/${specialistType} idle:`, error);
    });

  // Start grace period (60 seconds)
  startGracePeriod(projectKey, specialistType, 60000);

  console.log(`[specialist] ${specialistType} completed for ${projectKey} (status: ${result.status})`);
}

/**
 * Terminate a specialist session
 *
 * Kills the tmux session, finalizes logs, and schedules digest generation.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
export async function terminateSpecialist(
  projectKey: string,
  specialistType: SpecialistAgentName,
  issueId?: string
): Promise<void> {
  const registryKey = issueId
    ? makeSpecialistRegistryKey(specialistType, issueId)
    : (findActiveRegistryKey(projectKey, specialistType) ?? specialistType);
  const metadata = getRunMetadata(projectKey, registryKey);

  // Derive tmuxSession: use stored field, or recompute
  const tmuxSession = metadata.tmuxSession ?? getTmuxSessionName(specialistType, projectKey, issueId);

  try {
    // Kill tmux session
    await killSessionAsync(tmuxSession);
    console.log(`[specialist] Terminated ${projectKey}/${specialistType}`);
  } catch (error) {
    console.error(`[specialist] Failed to kill tmux session ${tmuxSession}:`, error);
  }

  // Finalize log if there's a current run
  if (metadata.currentRun) {
    const { finalizeRunLog } = await import('./specialist-logs.js');

    try {
      finalizeRunLog(projectKey, specialistType, metadata.currentRun, {
        status: metadata.lastRunStatus || 'incomplete',
        notes: 'Specialist terminated',
      });
    } catch (error) {
      console.error(`[specialist] Failed to finalize log:`, error);
    }

    // Clear current run
    setCurrentRun(projectKey, registryKey, null);
  }

  updateRunMetadata(projectKey, registryKey, { currentActivity: null });

  // Clear grace period state
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  // Update runtime state
  const { saveAgentRuntimeState } = await import('../agents.js');
  saveAgentRuntimeState(tmuxSession, {
    state: 'suspended',
    lastActivity: new Date().toISOString(),
  });

  // Schedule digest generation (async, fire-and-forget)
  const { scheduleDigestGeneration } = await import('./specialist-context.js');
  scheduleDigestGeneration(projectKey, specialistType);

  // Run log cleanup for this project/specialist (async, fire-and-forget)
  scheduleLogCleanup(projectKey, specialistType);
}

/**
 * Schedule log cleanup for a project's specialist (async, fire-and-forget)
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 */
function scheduleLogCleanup(projectKey: string, specialistType: SpecialistAgentName): void {
  // Run async without awaiting
  Promise.resolve().then(async () => {
    try {
      const { cleanupOldLogs } = await import('./specialist-logs.js');
      const { getSpecialistRetention } = await import('../projects.js');

      const retention = getSpecialistRetention(projectKey);
      const deleted = cleanupOldLogs(projectKey, specialistType, { maxDays: retention.max_days, maxRuns: retention.max_runs });

      if (deleted > 0) {
        console.log(`[specialist] Cleaned up ${deleted} old logs for ${projectKey}/${specialistType}`);
      }
    } catch (error) {
      console.error(`[specialist] Log cleanup failed for ${projectKey}/${specialistType}:`, error);
    }
  });
}

/**
 * ===========================================================================
 * Per-Project Specialist Functions
 * ===========================================================================
 */

/**
 * Get the directory for a project's specialist
 */
export function getProjectSpecialistDir(projectKey: string, specialistType: SpecialistAgentName): string {
  return join(SPECIALISTS_DIR, projectKey, specialistType);
}

/**
 * Ensure per-project specialist directory structure exists
 */
export function ensureProjectSpecialistDir(projectKey: string, specialistType: SpecialistAgentName): void {
  const specialistDir = getProjectSpecialistDir(projectKey, specialistType);
  const runsDir = join(specialistDir, 'runs');
  const contextDir = join(specialistDir, 'context');

  if (!existsSync(runsDir)) {
    mkdirSync(runsDir, { recursive: true });
  }
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }
}

/**
 * Get metadata for a specific (projectKey, registryKey) pair.
 * registryKey is either a plain specialistType (legacy) or a compound key from makeSpecialistRegistryKey().
 */
export function getRunMetadata(
  projectKey: string,
  registryKey: string,
): ProjectSpecialistMetadata {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][registryKey]) {
    registry.projects[projectKey][registryKey] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
    saveRegistry(registry);
  }

  return registry.projects[projectKey][registryKey];
}

/**
 * Update metadata for a specific (projectKey, registryKey) pair.
 */
export function updateRunMetadata(
  projectKey: string,
  registryKey: string,
  updates: Partial<ProjectSpecialistMetadata>
): void {
  const registry = loadRegistry();

  if (!registry.projects[projectKey]) {
    registry.projects[projectKey] = {};
  }

  if (!registry.projects[projectKey][registryKey]) {
    registry.projects[projectKey][registryKey] = {
      runCount: 0,
      lastRunAt: null,
      lastRunStatus: null,
      currentRun: null,
    };
  }

  registry.projects[projectKey][registryKey] = {
    ...registry.projects[projectKey][registryKey],
    ...updates,
  };

  saveRegistry(registry);
}

/**
 * Get per-project specialist metadata — backward-compat wrapper.
 * Searches compound-key entries for this project+type; returns the active run, or most recent.
 */
export function getProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistAgentName
): ProjectSpecialistMetadata {
  const registry = loadRegistry();
  const projectBucket = registry.projects[projectKey] ?? {};

  // Check for exact legacy key first
  if (projectBucket[specialistType]) {
    return projectBucket[specialistType];
  }

  // Search compound keys for the most relevant entry
  const prefix = `${specialistType}:`;
  const candidates = Object.entries(projectBucket)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v);

  // Prefer active run, then most recently started
  const active = candidates.find(c => c.currentRun !== null);
  if (active) return active;
  const sorted = candidates.sort((a, b) =>
    (b.lastRunAt ?? '').localeCompare(a.lastRunAt ?? '')
  );
  if (sorted.length > 0) return sorted[0];

  // No entry found — return blank default (don't save it)
  return { runCount: 0, lastRunAt: null, lastRunStatus: null, currentRun: null };
}

/**
 * Update per-project specialist metadata — backward-compat wrapper.
 * Updates the active compound-key entry, or the legacy plain-key entry.
 */
export function updateProjectSpecialistMetadata(
  projectKey: string,
  specialistType: SpecialistAgentName,
  updates: Partial<ProjectSpecialistMetadata>
): void {
  const registry = loadRegistry();
  const projectBucket = registry.projects[projectKey] ?? {};

  // Try legacy key first
  if (projectBucket[specialistType]) {
    updateRunMetadata(projectKey, specialistType, updates);
    return;
  }

  // Find the active compound-key entry for this type
  const prefix = `${specialistType}:`;
  const activeKey = Object.keys(projectBucket).find(k =>
    k.startsWith(prefix) && projectBucket[k].currentRun !== null
  );
  if (activeKey) {
    updateRunMetadata(projectKey, activeKey, updates);
    return;
  }

  // Fall back to most recent
  const latestKey = Object.keys(projectBucket)
    .filter(k => k.startsWith(prefix))
    .sort((a, b) => (projectBucket[b].lastRunAt ?? '').localeCompare(projectBucket[a].lastRunAt ?? ''))
    .shift();
  if (latestKey) {
    updateRunMetadata(projectKey, latestKey, updates);
  }
}

/**
 * Increment run count for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function incrementProjectRunCount(projectKey: string, registryKey: string): void {
  const metadata = getRunMetadata(projectKey, registryKey);
  updateRunMetadata(projectKey, registryKey, {
    runCount: metadata.runCount + 1,
    lastRunAt: new Date().toISOString(),
  });
}

/**
 * Set current run for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function setCurrentRun(
  projectKey: string,
  registryKey: string,
  runId: string | null
): void {
  updateRunMetadata(projectKey, registryKey, { currentRun: runId });
}

/**
 * Update run status for a project's specialist.
 * registryKey may be a plain specialistType (legacy) or a compound key.
 */
export function updateRunStatus(
  projectKey: string,
  registryKey: string,
  status: 'passed' | 'failed' | 'blocked' | null
): void {
  updateRunMetadata(projectKey, registryKey, { lastRunStatus: status });
}

/**
 * List all projects that have specialists configured
 */
export function listProjectsWithSpecialists(): string[] {
  const registry = loadRegistry();
  return Object.keys(registry.projects);
}

/**
 * List all specialist types for a project
 */
export function listSpecialistsForProject(projectKey: string): SpecialistAgentName[] {
  const registry = loadRegistry();
  const project = registry.projects[projectKey];

  if (!project) {
    return [];
  }

  return Object.keys(project) as SpecialistAgentName[];
}

/**
 * Get all per-project specialist statuses (PAN-754: compound-key aware).
 * Walks registry including compound keys (type:issueId[:role]) and returns
 * enriched entries with issueId, model, currentActivity for the Agents page.
 */
export async function getAllProjectSpecialistStatuses(): Promise<Array<{
  projectKey: string;
  specialistType: SpecialistAgentName;
  registryKey: string;
  issueId?: string;
  role?: string;
  metadata: ProjectSpecialistMetadata;
  isRunning: boolean;
  tmuxSession: string;
}>> {
  const registry = loadRegistry();
  const { getAgentRuntimeState } = await import('../agents.js');

  const results: Array<{
    projectKey: string;
    specialistType: SpecialistAgentName;
    registryKey: string;
    issueId?: string;
    role?: string;
    metadata: ProjectSpecialistMetadata;
    isRunning: boolean;
    tmuxSession: string;
  }> = [];

  for (const [projectKey, specialists] of Object.entries(registry.projects)) {
    for (const [registryKey, metadata] of Object.entries(specialists)) {
      const { specialistType, issueId, role } = parseSpecialistRegistryKey(registryKey);

      // Determine tmux session: use stored field when available
      const tmuxSession = metadata.tmuxSession
        ?? getTmuxSessionName(specialistType as SpecialistAgentName, projectKey, issueId);

      const runtimeState = getAgentRuntimeState(tmuxSession);
      const sessionRunning = await isRunning(specialistType as SpecialistAgentName, projectKey).catch(() => false);
      const running = isProjectSpecialistActivelyRunning(runtimeState, sessionRunning);
      const effectiveMetadata = running ? metadata : { ...metadata, currentRun: null };

      results.push({
        projectKey,
        specialistType: specialistType as SpecialistAgentName,
        registryKey,
        issueId,
        role,
        metadata: effectiveMetadata,
        isRunning: running,
        tmuxSession,
      });
    }
  }

  return results;
}

/**
 * Update context token count for a specialist
 *
 * @param name - Specialist name
 * @param tokens - Total context tokens
 */
export function updateContextTokens(name: SpecialistAgentName, tokens: number): void {
  updateSpecialistMetadata(name, { contextTokens: tokens });
}

/**
 * Enable a specialist
 *
 * @param name - Specialist name
 */
export function enableSpecialist(name: SpecialistAgentName): void {
  updateSpecialistMetadata(name, { enabled: true });
}

/**
 * Disable a specialist
 *
 * @param name - Specialist name
 */
export function disableSpecialist(name: SpecialistAgentName): void {
  updateSpecialistMetadata(name, { enabled: false });
}

/**
 * Check if a specialist is enabled
 *
 * @param name - Specialist name
 * @returns True if specialist is enabled
 */
export function isEnabled(name: SpecialistAgentName): boolean {
  const metadata = getSpecialistMetadata(name);
  return metadata?.enabled ?? false;
}

/**
 * Get all enabled specialists
 *
 * @returns Array of enabled specialists
 */
export function getEnabledSpecialists(): LegacySpecialistDefinition[] {
  return getAllSpecialists().filter((s) => s.enabled);
}

/**
 * Find JSONL file for a session ID
 *
 * Searches through Claude Code project directories to find the JSONL file.
 *
 * @param sessionId - Session ID to find
 * @returns Path to JSONL file or null if not found
 */
export function findSessionFile(sessionId: string): string | null {
  try {
    const allFiles = getAllSessionFiles();

    for (const file of allFiles) {
      const fileSessionId = basename(file, '.jsonl');
      if (fileSessionId === sessionId) {
        return file;
      }
    }
  } catch {
    // Session files not available
  }

  return null;
}

/**
 * Count context tokens for a specialist session
 *
 * Reads the JSONL file for the specialist's session and sums all token usage.
 * This gives an approximate count of context size.
 *
 * @param name - Specialist name
 * @returns Total token count or null if session not found
 */
export function countContextTokens(name: SpecialistAgentName): number | null {
  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name));

  if (!sessionId) {
    return null;
  }

  const sessionFile = findSessionFile(sessionId);

  if (!sessionFile) {
    return null;
  }

  const sessionUsage = parseClaudeSession(sessionFile);

  if (!sessionUsage) {
    return null;
  }

  // Sum all token types for total context
  return (
    sessionUsage.usage.inputTokens +
    sessionUsage.usage.outputTokens +
    (sessionUsage.usage.cacheReadTokens || 0) +
    (sessionUsage.usage.cacheWriteTokens || 0)
  );
}

/**
 * Check if a specialist is currently running in tmux
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns True if specialist has an active tmux session
 */
export async function isRunning(name: SpecialistAgentName, projectKey?: string): Promise<boolean> {
  const tmuxSession = getTmuxSessionName(name, projectKey);

  try {
    const exists = await sessionExistsAsync(tmuxSession);
    if (!exists) return false;
    // Session exists — but check if the pane actually has a running process.
    // When Claude Code crashes, the pane's process exits but the tmux session persists,
    // making has-session return success even though nothing is running.
    const panePid = (await listPaneValuesAsync(tmuxSession, '#{pane_pid}'))[0]?.trim() ?? '';
    if (!panePid) return false;
    // Check if the pane's process has any child processes (Claude Code / bash)
    const { stdout: children } = await execAsync(
      `ps --ppid ${panePid} --no-headers 2>/dev/null || echo ""`,
      { encoding: 'utf-8' }
    );
    return children.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Get complete status for a specialist
 *
 * Combines metadata, session info, and runtime state (PAN-80: uses hook-based state).
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Complete specialist status
 */
export async function getSpecialistStatus(
  name: SpecialistAgentName,
  projectKey?: string
): Promise<LegacySpecialistRuntimeStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = readRecordedClaudeSessionId(getTmuxSessionName(name, projectKey));
  const running = await isRunning(name, projectKey);
  const contextTokens = countContextTokens(name);

  // Determine state from hook-based runtime state (PAN-80)
  const { getAgentRuntimeState } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name, projectKey);
  const runtimeState = getAgentRuntimeState(tmuxSession);

  let state: SpecialistLifecycleState;
  if (runtimeState) {
    // Map runtime state to specialist state
    switch (runtimeState.state) {
      case 'active':
        state = 'active';
        break;
      case 'idle':
        state = 'sleeping'; // Idle = at prompt waiting
        break;
      case 'suspended':
        state = 'sleeping'; // Suspended = session saved, not running
        break;
      case 'uninitialized':
      default:
        state = 'uninitialized';
        break;
    }
  } else {
    // Fallback if no runtime state available
    if (running && sessionId) {
      state = 'sleeping';
    } else if (sessionId) {
      state = 'sleeping';
    } else {
      state = 'uninitialized';
    }
  }

  return {
    ...metadata,
    sessionId: sessionId || undefined,
    contextTokens: contextTokens || undefined,
    state,
    isRunning: running,
    tmuxSession: getTmuxSessionName(name, projectKey),
    currentIssue: running ? runtimeState?.currentIssue : undefined,
  };
}

/**
 * Get status for all specialists
 *
 * @returns Array of specialist statuses
 */
export async function getAllSpecialistStatus(): Promise<LegacySpecialistRuntimeStatus[]> {
  const specialists = getAllSpecialists();
  return Promise.all(specialists.map((metadata) => getSpecialistStatus(metadata.name)));
}


/**
 * Initialize all enabled but uninitialized specialists
 *
 * Called during Cloister startup to ensure specialists are ready.
 *
 * @returns Promise with array of initialization results
 */
export async function initializeEnabledSpecialists(): Promise<Array<{
  name: SpecialistAgentName;
  success: boolean;
  message: string;
}>> {
  const enabled = getEnabledSpecialists();
  const results: Array<{ name: SpecialistAgentName; success: boolean; message: string }> = [];

  for (const specialist of enabled) {
    results.push({
      name: specialist.name,
      success: true,
      message: 'Legacy global specialist initialization removed; role flows spawn agents on demand.',
    });
  }

  return results;
}

/**
 * ===========================================================================
 * Specialist Feedback System
 * ===========================================================================
 *
 * Specialists accumulate context and expertise. This system allows them to
 * share learnings back to issue agents, creating a feedback loop that
 * improves the overall system over time.
 */

/**
 * Feedback from a specialist to an issue agent
 */
export interface SpecialistFeedback {
  id: string;
  timestamp: string;
  fromSpecialist: SpecialistAgentName;
  toIssueId: string;
  feedbackType: 'success' | 'failure' | 'warning' | 'insight';
  category: 'merge' | 'test' | 'review' | 'general';
  summary: string;
  details: string;
  actionItems?: string[];
  patterns?: string[];  // Patterns the specialist noticed
  suggestions?: string[];  // Suggestions for the issue agent
}

const FEEDBACK_DIR = join(PANOPTICON_HOME, 'specialists', 'feedback');
const FEEDBACK_LOG = join(FEEDBACK_DIR, 'feedback.jsonl');

/**
 * Send feedback from a specialist to an issue agent
 *
 * This is the key mechanism for specialists to share their accumulated
 * expertise back to the issue agents that spawned the work.
 *
 * @param feedback - The feedback to send
 * @returns True if feedback was sent successfully
 */
export async function sendFeedbackToAgent(
  feedback: Omit<SpecialistFeedback, 'id' | 'timestamp'>
): Promise<boolean> {
  const { fromSpecialist, toIssueId, summary, details } = feedback;

  // Ensure feedback directory exists
  if (!existsSync(FEEDBACK_DIR)) {
    mkdirSync(FEEDBACK_DIR, { recursive: true });
  }

  // Create full feedback record
  const fullFeedback: SpecialistFeedback = {
    ...feedback,
    id: `feedback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
  };

  // Log feedback to JSONL
  try {
    const line = JSON.stringify(fullFeedback) + '\n';
    appendFileSync(FEEDBACK_LOG, line, 'utf-8');
  } catch (error) {
    console.error(`[specialist] Failed to log feedback:`, error);
  }

  // Try to send feedback to the issue agent
  const agentSession = `agent-${toIssueId.toLowerCase()}`;

  // Format feedback message for the agent
  const feedbackMessage = formatFeedbackForAgent(fullFeedback);

  // Write feedback to workspace file
  const { writeFeedbackFile } = await import('./feedback-writer.js');
  const specialistMap: Record<string, 'review-agent' | 'test-agent' | 'merge-agent'> = {
    'review-agent': 'review-agent',
    'test-agent': 'test-agent',
    'merge-agent': 'merge-agent',
  };
  const specialist = specialistMap[fromSpecialist] || 'review-agent';
  const outcome = feedback.feedbackType === 'success' ? 'approved' : feedback.feedbackType === 'failure' ? 'failed' : feedback.feedbackType;

  const fileResult = await writeFeedbackFile({
    issueId: toIssueId,
    specialist,
    outcome,
    summary: summary.slice(0, 100),
    markdownBody: feedbackMessage,
  });

  if (!fileResult.success) {
    console.error(`[specialist] Failed to write feedback file for ${toIssueId}: ${fileResult.error}`);
    return false;
  }

  // Send a short, explicit message with the ABSOLUTE path.
  try {
    const { messageAgent } = await import('../agents.js');
    const msg = `SPECIALIST FEEDBACK: ${fromSpecialist} reported ${feedback.feedbackType.toUpperCase()} for ${toIssueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then address the feedback and continue working. Do NOT stop at the prompt.`;
    await messageAgent(agentSession, msg);
    console.log(`[specialist] Sent feedback from ${fromSpecialist} to ${agentSession} (file: ${fileResult.filePath})`);
    return true;
  } catch (err) {
    // Agent may be gone — feedback file is still in the workspace for crash recovery
    console.log(`[specialist] Could not send reference to ${agentSession} (file written): ${err}`);
    return true; // File was written successfully, that's the important part
  }
}

/**
 * Format feedback for display to an agent
 */
function formatFeedbackForAgent(feedback: SpecialistFeedback): string {
  const { fromSpecialist, feedbackType, category, summary, details, actionItems, patterns, suggestions } = feedback;

  const typeEmoji = {
    success: '✅',
    failure: '❌',
    warning: '⚠️',
    insight: '💡',
  }[feedbackType];

  let message = `\n${typeEmoji} **Feedback from ${fromSpecialist}** (${category})\n\n`;
  message += `**Summary:** ${summary}\n\n`;
  message += `**Details:**\n${details}\n`;

  if (actionItems?.length) {
    message += `\n**Action Items:**\n`;
    actionItems.forEach((item, i) => {
      message += `${i + 1}. ${item}\n`;
    });
  }

  if (patterns?.length) {
    message += `\n**Patterns Noticed:**\n`;
    patterns.forEach(pattern => {
      message += `- ${pattern}\n`;
    });
  }

  if (suggestions?.length) {
    message += `\n**Suggestions:**\n`;
    suggestions.forEach(suggestion => {
      message += `- ${suggestion}\n`;
    });
  }

  return message;
}

/**
 * Get pending feedback for an issue that hasn't been delivered yet
 *
 * @param issueId - Issue ID to get feedback for
 * @returns Array of feedback records
 */
export function getPendingFeedback(issueId: string): SpecialistFeedback[] {
  if (!existsSync(FEEDBACK_LOG)) {
    return [];
  }

  try {
    const content = readFileSync(FEEDBACK_LOG, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const allFeedback = lines.map(line => JSON.parse(line) as SpecialistFeedback);

    // Filter to this issue
    return allFeedback.filter(f => f.toIssueId.toLowerCase() === issueId.toLowerCase());
  } catch (error) {
    console.error(`[specialist] Failed to read feedback log:`, error);
    return [];
  }
}

/**
 * Get feedback statistics for all specialists
 *
 * @returns Feedback stats by specialist and type
 */
export function getFeedbackStats(): {
  bySpecialist: Record<SpecialistAgentName, number>;
  byType: Record<string, number>;
  total: number;
} {
  const stats = {
    bySpecialist: {
      'merge-agent': 0,
      'review-agent': 0,
      'test-agent': 0,
    } as Record<SpecialistAgentName, number>,
    byType: {} as Record<string, number>,
    total: 0,
  };

  if (!existsSync(FEEDBACK_LOG)) {
    return stats;
  }

  try {
    const content = readFileSync(FEEDBACK_LOG, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);

    for (const line of lines) {
      const feedback = JSON.parse(line) as SpecialistFeedback;
      stats.bySpecialist[feedback.fromSpecialist] = (stats.bySpecialist[feedback.fromSpecialist] || 0) + 1;
      stats.byType[feedback.feedbackType] = (stats.byType[feedback.feedbackType] || 0) + 1;
      stats.total++;
    }
  } catch (error) {
    console.error(`[specialist] Failed to read feedback stats:`, error);
  }

  return stats;
}
