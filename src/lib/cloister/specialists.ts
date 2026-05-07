/**
 * Cloister Specialist Agents
 *
 * Manages long-running specialist agents that can be woken up on demand.
 * Specialists maintain context across invocations via session files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { randomUUID, createHash } from 'crypto';
import { PANOPTICON_HOME } from '../paths.js';
import { getDevrootPath } from '../config.js';
import { getProject } from '../projects.js';
import { getAllSessionFiles, parseClaudeSession } from '../cost-parsers/jsonl-parser.js';
import { createSpecialistHandoff, logSpecialistHandoff } from './specialist-handoff-logger.js';
import type { ModelId } from '../settings.js';
import { loadConfig as loadYamlConfig } from '../config-yaml.js';
import { loadCloisterConfig } from './config.js';
import { readCavemanVariant } from '../caveman/workspace.js';
import { getModelId, WorkTypeId } from '../work-type-router.js';
import { getProviderForModel, setupCredentialFileAuth, clearCredentialFileAuth } from '../providers.js';
import { getProviderEnvForModel } from '../agents.js';
import { generateLauncherScript, generateLauncherWrapper } from '../launcher-generator.js';
import { resolveSpecialistBaseCommand } from './router.js';
import { sendKeysAsync, capturePaneAsync, waitForClaudePrompt, confirmDelivery, createSessionAsync, killSessionAsync, buildTmuxCommandString, listPaneValuesAsync, listSessionNamesAsync, sessionExistsAsync } from '../tmux.js';
import { notifyPipeline } from '../pipeline-notifier.js';
import { isTaskReady } from './task-readiness.js';
import { renderPrompt } from './prompts.js';

const execAsync = promisify(exec);

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
const TASKS_DIR = join(SPECIALISTS_DIR, 'tasks');

/**
 * Supported specialist types
 */
export type SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent';

/**
 * Specialist state
 */
export type SpecialistState = 'sleeping' | 'active' | 'uninitialized';

/**
 * Specialist metadata
 */
export interface SpecialistMetadata {
  name: SpecialistType;
  displayName: string;
  description: string;
  enabled: boolean;
  autoWake: boolean;
  sessionId?: string;
  lastWake?: string; // ISO 8601 timestamp
  contextTokens?: number;
}

/**
 * Specialist status including runtime state
 */
export interface SpecialistStatus extends SpecialistMetadata {
  state: SpecialistState;
  isRunning: boolean;
  tmuxSession?: string;
  currentIssue?: string; // Issue ID currently being worked on
}

/**
 * One step in the model resolution trace (PAN-754)
 */
export interface ResolutionStep {
  source: 'explicit-param' | 'work-type-router' | 'cloister-config' | 'fallback';
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
  specialists?: SpecialistMetadata[];
  lastUpdated: string; // ISO 8601 timestamp
}

/**
 * Default specialist definitions
 */
const DEFAULT_SPECIALISTS: SpecialistMetadata[] = [
  {
    name: 'merge-agent',
    displayName: 'Merge Agent',
    description: 'Final merge validation and handoff specialist',
    enabled: true,
    autoWake: false,
  },
  {
    name: 'review-agent',
    displayName: 'Review Agent',
    description: 'Code review and quality checks',
    enabled: true,
    autoWake: false,
  },
  {
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'Test execution and analysis',
    enabled: true,
    autoWake: true,
  },
  {
    name: 'inspect-agent',
    displayName: 'Inspect Agent',
    description: 'Per-bead specification and diff inspection',
    enabled: true,
    autoWake: false,
  },
  {
    name: 'uat-agent',
    displayName: 'UAT Agent',
    description: 'Browser-based user acceptance testing',
    enabled: true,
    autoWake: true,
  },
];

/**
 * Initialize specialists directory and registry
 *
 * Creates directory structure and default registry.json if needed.
 * Safe to call multiple times - idempotent.
 */
export function initSpecialistsDirectory(): void {
  // Ensure specialists directory exists
  if (!existsSync(SPECIALISTS_DIR)) {
    mkdirSync(SPECIALISTS_DIR, { recursive: true });
  }

  // Create default registry if it doesn't exist
  if (!existsSync(REGISTRY_FILE)) {
    const registry: SpecialistRegistry = {
      version: '3.0', // Updated for compound-key (issueId-aware) structure (PAN-754)
      defaults: {
        contextRuns: 5,
        digestModel: null,
        retention: {
          maxDays: 30,
          maxRuns: 50,
        },
      },
      projects: {},
      // Keep legacy specialists for backward compatibility during transition
      specialists: DEFAULT_SPECIALISTS,
      lastUpdated: new Date().toISOString(),
    };
    saveRegistry(registry);
  } else {
    // Migrate old registry if needed
    migrateRegistryIfNeeded();
  }
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
  initSpecialistsDirectory();

  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load specialist registry:', error);
    // Return default registry
    return {
      version: '1.0',
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
  // Only ensure directory exists, don't call initSpecialistsDirectory to avoid recursion
  if (!existsSync(SPECIALISTS_DIR)) {
    mkdirSync(SPECIALISTS_DIR, { recursive: true });
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
 * Get session file path for a specialist.
 * Per-project specialists use a project-scoped subdirectory to prevent
 * session ID collision when multiple projects share the same specialist type.
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns Path to session file
 */
export function getSessionFilePath(name: SpecialistType, projectKey?: string): string {
  if (projectKey) {
    return join(SPECIALISTS_DIR, 'projects', projectKey, `${name}.session`);
  }
  return join(SPECIALISTS_DIR, `${name}.session`);
}

/**
 * Read session ID from file
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns Session ID or null if not found
 */
export function getSessionId(name: SpecialistType, projectKey?: string): string | null {
  const sessionFile = getSessionFilePath(name, projectKey);

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    const sessionId = readFileSync(sessionFile, 'utf-8').trim();
    // Validate UUID format — Claude Code requires valid UUIDs for --resume and --session-id.
    // Old deterministic IDs (e.g., "specialist-mind-your-now-review-agent") are not valid UUIDs.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      console.warn(`[specialist] Invalid session ID format for ${name} (${projectKey ?? 'global'}): ${sessionId} — discarding`);
      unlinkSync(sessionFile);
      return null;
    }
    return sessionId;
  } catch (error) {
    console.error(`Failed to read session file for ${name} (${projectKey ?? 'global'}):`, error);
    return null;
  }
}

/**
 * Write session ID to file
 *
 * @param name - Specialist name
 * @param sessionId - Session ID to store
 * @param projectKey - Optional project key (per-project specialists only)
 */
/**
 * Get the current session generation (for rotating session IDs).
 * Returns 0 if no generation file exists.
 */
export function getSessionGeneration(name: SpecialistType, projectKey?: string): number {
  const genFile = getSessionFilePath(name, projectKey) + '.gen';
  if (!existsSync(genFile)) return 0;
  try {
    return parseInt(readFileSync(genFile, 'utf-8').trim(), 10) || 0;
  } catch { return 0; }
}

/**
 * Bump the session generation — next dispatch will use a new session ID.
 * Old JSONL files are preserved (not deleted).
 */
export function bumpSessionGeneration(name: SpecialistType, projectKey?: string): number {
  const genFile = getSessionFilePath(name, projectKey) + '.gen';
  const dir = projectKey
    ? join(SPECIALISTS_DIR, 'projects', projectKey)
    : SPECIALISTS_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const newGen = getSessionGeneration(name, projectKey) + 1;
  writeFileSync(genFile, String(newGen));
  return newGen;
}

export function setSessionId(name: SpecialistType, sessionId: string, projectKey?: string): void {
  const sessionFile = getSessionFilePath(name, projectKey);
  const dir = projectKey
    ? join(SPECIALISTS_DIR, 'projects', projectKey)
    : SPECIALISTS_DIR;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  try {
    writeFileSync(sessionFile, sessionId.trim(), 'utf-8');
  } catch (error) {
    console.error(`Failed to write session file for ${name} (${projectKey ?? 'global'}):`, error);
    throw error;
  }
}

/**
 * Delete session file
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key (per-project specialists only)
 * @returns True if file was deleted, false if it didn't exist
 */
export function clearSessionId(name: SpecialistType, projectKey?: string): boolean {
  const sessionFile = getSessionFilePath(name, projectKey);

  if (!existsSync(sessionFile)) {
    return false;
  }

  try {
    unlinkSync(sessionFile);
    return true;
  } catch (error) {
    console.error(`Failed to delete session file for ${name} (${projectKey ?? 'global'}):`, error);
    throw error;
  }
}

/**
 * Get metadata for a specific specialist
 *
 * @param name - Specialist name
 * @returns Specialist metadata or null if not found
 */
export function getSpecialistMetadata(name: SpecialistType): SpecialistMetadata | null {
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
  name: SpecialistType,
  updates: Partial<SpecialistMetadata>
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
export function getAllSpecialists(): SpecialistMetadata[] {
  const registry = loadRegistry();
  return registry.specialists ?? [];
}

/**
 * Check if a specialist is initialized (has session file)
 *
 * @param name - Specialist name
 * @returns True if specialist has a session file
 */
export function isInitialized(name: SpecialistType): boolean {
  return getSessionId(name) !== null;
}

/**
 * Get the state of a specialist based on session file
 *
 * Note: This only checks if session exists, not if it's actually running.
 * Use getSpecialistStatus() for runtime state.
 *
 * @param name - Specialist name
 * @returns Specialist state
 */
export function getSpecialistState(name: SpecialistType): Exclude<SpecialistState, 'active'> {
  return isInitialized(name) ? 'sleeping' : 'uninitialized';
}

/**
 * Get tmux session name for a specialist
 *
 * @param name - Specialist name
 * @param projectKey - Optional project key for per-project specialists
 * @returns Expected tmux session name
 */
export function getTmuxSessionName(name: SpecialistType, projectKey?: string, issueId?: string): string {
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
 * Get the canonical reviewer tmux session name (PAN-830).
 *
 * Pattern: `specialist-<projectKey>-<issueId>-review-<role>`. This is one
 * tmux session per role per issue — sessions are reused across review
 * rounds via `sendKeysAsync` resumption. Round 2 of `review-correctness`
 * does NOT spawn a new session; it injects a follow-up prompt into the
 * existing pane.
 *
 * @param role - One of the canonical reviewer roles
 * @param projectKey - Project key (e.g. `panopticon`)
 * @param issueId - Issue identifier (e.g. `pan-540`)
 * @returns Canonical tmux session name
 */
export function getReviewerSessionName(
  role: ReviewerRole,
  projectKey: string,
  issueId: string,
): string {
  return `specialist-${projectKey}-${issueId}-review-${role}`;
}

/**
 * Parse a canonical reviewer session name back into role + project + issue.
 * Returns null if the name does not match the canonical pattern.
 */
export function parseReviewerSessionName(name: string): {
  role: ReviewerRole;
  projectKey: string;
  issueId: string;
} | null {
  const m = name.match(/^specialist-([\w.-]+?)-([\w.-]+?)-review-(correctness|security|performance|requirements|synthesis)$/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { projectKey: m[1], issueId: m[2], role: m[3] as ReviewerRole };
}

/**
 * Construct the compound registry key for a per-issue specialist (PAN-754).
 * Format: `${specialistType}:${issueId}` or `${specialistType}:${issueId}:${role}` for convoy.
 */
export function makeSpecialistRegistryKey(specialistType: string, issueId: string, role?: string): string {
  return role ? `${specialistType}:${issueId}:${role}` : `${specialistType}:${issueId}`;
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
export function recordWake(name: SpecialistType, sessionId?: string): void {
  const updates: Partial<SpecialistMetadata> = {
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
 * Spawn an ephemeral specialist for a project
 *
 * Creates a new specialist session that will run for this task and then terminate.
 * The specialist is seeded with context from recent runs.
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param task - Task details
 * @returns Spawn result with run ID and session info
 */
export async function spawnEphemeralSpecialist(
  projectKey: string,
  specialistType: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
    promptOverride?: string; // Use this prompt instead of building from template
    model?: string;
  }
): Promise<{
  success: boolean;
  runId?: string;
  tmuxSession?: string;
  message: string;
  error?: string;
}> {
  // Ensure project specialist directory exists
  ensureProjectSpecialistDir(projectKey, specialistType);

  const registryKey = makeSpecialistRegistryKey(specialistType, task.issueId);
  const tmuxSession = getTmuxSessionName(specialistType, projectKey, task.issueId);

  // Busy check FIRST — before any state mutation. A rejected dispatch must NOT
  // create a run log, advance currentRun, or write task files into the shared
  // agent directory. Earlier ordering polluted metadata and left empty
  // "incomplete" log files when a concurrent dispatch was rejected.
  try {
    const sessions = await listSessionNamesAsync();
    if (sessions.includes(tmuxSession)) {
      const { getAgentRuntimeState } = await import('../agents.js');
      const existingState = getAgentRuntimeState(tmuxSession);
      if (existingState?.state === 'active') {
        // PAN-511: verify the session is actually running before treating it as busy.
        const actuallyRunning = await isRunning(specialistType, projectKey);
        if (actuallyRunning) {
          return {
            success: false,
            message: `Specialist ${specialistType} (${projectKey}) is already running task ${existingState.currentIssue ?? 'unknown'}`,
            error: 'specialist_busy',
          };
        }
        console.log(`[specialist] ${tmuxSession} state=active but not running — clearing stale state`);
        const { saveAgentRuntimeState } = await import('../agents.js');
        saveAgentRuntimeState(tmuxSession, {
          state: 'idle',
          lastActivity: new Date().toISOString(),
          currentIssue: undefined,
        });
      }
      // Stale or idle session — kill it (and any orphaned descendants) before spawning fresh
      console.log(`[specialist] Killing stale ${tmuxSession} session before respawn`);
      await killSessionAsync(tmuxSession).catch(() => {});
      // Belt-and-suspenders: terminate any orphaned launcher/script/claude trees
      // that previous broken pipelines left parented to the tmux server.
      await execAsync(
        `pkill -TERM -f "agents/${tmuxSession}/run-claude.sh" 2>/dev/null || true; pkill -TERM -f "agents/${tmuxSession}/launcher.sh" 2>/dev/null || true`,
        { encoding: 'utf-8' },
      ).catch(() => {});
    }
  } catch {
    // Non-fatal: session check failure shouldn't block spawn
  }

  // Write-scope enforcement (PAN-754): enforce single-writer-per-worktree policy.
  // 'full' scope specialists have exclusive write access; only one may run per workspace.
  // 'readonly-plus-output' specialists (convoy reviewers) may run concurrently as long
  // as their outputPath values are disjoint.
  if (task.workspace) {
    const registry = loadRegistry();
    const projectBucket = registry.projects[projectKey] ?? {};
    // Snapshot live tmux sessions once so liveness checks below don't fan out
    // a tmux subprocess per registry entry.
    const liveSessions = await listSessionNamesAsync().catch(() => [] as string[]);
    for (const [key, entry] of Object.entries(projectBucket)) {
      if (key === registryKey) continue; // same slot — handled by busy check above
      if (!entry.currentRun) continue; // not running
      if (entry.workspace !== task.workspace) continue; // different worktree — no conflict

      // Liveness check: a registry entry's currentRun is only authoritative if
      // its tmux session is actually alive. Specialist tmux sessions can die
      // (process crash, manual kill, host reboot, OOM) without the cleanup path
      // running, leaving currentRun set. Without this check, a dead specialist
      // permanently blocks every future writer on the same worktree — sync-main,
      // merge-agent, anything. Only handle the standard {specialistType}:{issueId}
      // key shape here; role-keyed convoy entries have bespoke session naming
      // and stay strict to avoid clearing live runs we can't reliably identify.
      const parsed = parseSpecialistRegistryKey(key);
      if (parsed.issueId && !parsed.role) {
        const expectedSession = getTmuxSessionName(
          parsed.specialistType as SpecialistType,
          projectKey,
          parsed.issueId,
        );
        if (!liveSessions.includes(expectedSession)) {
          console.log(
            `[specialist] Clearing stale currentRun for ${key} (${projectKey}) — tmux session ${expectedSession} is dead`,
          );
          setCurrentRun(projectKey, key, null);
          continue;
        }
      }

      // Another specialist is running against the same workspace
      const incomingScope = 'full'; // default; convoy callers will pass 'readonly-plus-output' via task.context
      if (incomingScope === 'full' || (entry.writeScope ?? 'full') === 'full') {
        return {
          success: false,
          message: `Write conflict: specialist ${key} (${projectKey}) is already running with full write scope on workspace ${task.workspace}`,
          error: 'worktree_write_conflict',
        };
      }
    }
  }

  // Load context digest
  const { loadContextDigest } = await import('./specialist-context.js');
  const contextDigest = loadContextDigest(projectKey, specialistType);

  // Create run log (only after we've committed to actually spawning)
  const { createRunLog } = await import('./specialist-logs.js');
  const { runId, filePath: logFilePath } = createRunLog(
    projectKey,
    specialistType,
    task.issueId,
    contextDigest || undefined
  );

  // Update metadata (3-level: projectKey + issueId + specialistType via compound key)
  setCurrentRun(projectKey, registryKey, runId);
  incrementProjectRunCount(projectKey, registryKey);

  // Build task prompt (use override if provided, otherwise build from template)
  const basePrompt = task.promptOverride ?? await buildTaskPrompt(projectKey, specialistType, task, contextDigest);

  if (task.promptOverride) {
    console.log(`[specialist] Using promptOverride for ${projectKey}/${task.issueId} (${basePrompt.length} chars)`);
  }

  // Prepend session-aware preamble: specialists accumulate context via --resume,
  // so they may have seen this issue before. They MUST re-execute fresh every time.
  const taskPrompt = `IMPORTANT: This is a NEW task dispatch. You may have context from prior runs in this session — that is useful background knowledge, but you MUST execute this task fresh RIGHT NOW. Do NOT skip steps or report cached results. Read the code, run the commands, and call the status update APIs as instructed below. Prior results are stale — the code may have changed.

${basePrompt}`;

  // Spawn tmux session — use project path so specialist has correct context
  const project = getProject(projectKey);
  const cwd = project?.path || getDevrootPath() || homedir();

  // Pre-trust cwd so specialists don't hit the trust prompt
  try {
    const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
    preTrustDirectory(cwd);
  } catch { /* non-fatal */ }

  try {
    // Determine model for this specialist
    // Priority: explicit param > work-type-router (config.yaml overrides) > cloister config defaults > fallback
    const fallbackModel = 'claude-sonnet-4-6';
    let model: string | undefined;
    const resolutionTrace: ResolutionStep[] = [];

    if (task.model) {
      model = task.model;
      resolutionTrace.push({ source: 'explicit-param', resolvedModel: task.model, matched: true });
      console.log(`[specialist] Using explicit model "${model}" for ${specialistType}`);
    }

    if (!model) try {
      const workTypeId: WorkTypeId = `specialist-${specialistType}` as WorkTypeId;
      const resolved = getModelId(workTypeId);
      if (resolved) {
        model = resolved;
        resolutionTrace.push({ source: 'work-type-router', workTypeId, resolvedModel: resolved, matched: true });
        console.log(`[specialist] Using model "${model}" for ${specialistType} (from work-type-router)`);
      }
    } catch {
      resolutionTrace.push({ source: 'work-type-router', workTypeId: `specialist-${specialistType}`, resolvedModel: '', matched: false });
    }

    if (!model) {
      try {
        const cloisterConfig = loadCloisterConfig();
        const normalizedName = specialistType.replace(/-/g, '_');
        const configuredAlias = (cloisterConfig.model_selection?.specialist_models as any)?.[normalizedName] as string | undefined;
        if (configuredAlias) {
          const modelMap: Record<string, string> = { opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5' };
          const resolved = modelMap[configuredAlias];
          if (resolved) {
            model = resolved;
            resolutionTrace.push({ source: 'cloister-config', configKey: normalizedName, resolvedAlias: configuredAlias, resolvedModel: resolved, matched: true });
            console.log(`[specialist] Using model "${model}" for ${specialistType} (from cloister config default)`);
          }
        }
      } catch {
        // Config lookup failed
      }
    }

    if (!model) {
      model = fallbackModel;
      resolutionTrace.push({ source: 'fallback', resolvedModel: fallbackModel, matched: true });
      console.warn(`[specialist] Falling back to default model "${fallbackModel}" for ${specialistType}`);
    }

    // Store model + trace + identity in registry metadata for Agent activity visibility
    updateRunMetadata(projectKey, registryKey, {
      model,
      resolutionTrace,
      issueId: task.issueId,
      tmuxSession,
      workspace: task.workspace ?? null,
      currentActivity: `Running ${specialistType} for ${task.issueId}`,
      writeScope: 'full',
    });

    // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
    const providerEnv = await getProviderEnvForModel(model);
    // Add Panopticon cost attribution env vars so heartbeat hook records correct stage/issue
    const sessionTypeLabel = specialistType.replace('-agent', ''); // review-agent → review
    const panopticonEnv: Record<string, string> = {
      PANOPTICON_AGENT_ID: tmuxSession,
      PANOPTICON_ISSUE_ID: task.issueId,
      PANOPTICON_SESSION_TYPE: sessionTypeLabel,
    };
    const envFlags = buildTmuxEnvFlags({ ...providerEnv, ...panopticonEnv });

    // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    const providerConfig = getProviderForModel(model as ModelId);
    if (providerConfig.authType === 'credential-file') {
      setupCredentialFileAuth(providerConfig, cwd);
    } else {
      clearCredentialFileAuth(cwd);
    }

    // All autonomous specialists need full permission bypass to avoid interactive prompts
    const permissionFlags = '--dangerously-skip-permissions --permission-mode bypassPermissions';

    // Write task prompt to file to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'task-prompt.md');
    writeFileSync(promptFile, taskPrompt);

    // Deterministic session ID: same specialist + project + generation gets the same UUID.
    // Bumping the generation (via API) rotates to a fresh session without deleting old JONLs.
    // Fresh session every dispatch (PAN-612/PAN-632): deterministic UUIDs collide
    // with --session-id when a prior session exists. randomUUID avoids collisions.
    const sessionId = randomUUID();

    // Write session file for informational purposes (pan specialists list)
    setSessionId(specialistType, sessionId, projectKey);

    // Pre-write session.id into the agent dir so the dashboard's jsonl-resolver
    // can locate the JSONL transcript before the heartbeat hook fires. Without
    // this, hasJsonl is false and the Command Deck conversation panel renders
    // "No conversation data available" for the entire dispatch lifetime.
    // (Mirrors the spawnReviewer pre-write in review-agent.ts:556.)
    writeFileSync(join(agentDir, 'session.id'), sessionId, 'utf-8');

    console.log(`[specialist] Dispatching ${specialistType} for ${projectKey}/${task.issueId} (session: ${sessionId.slice(0, 8)}...)`);

    // Single launcher script: always try --resume first (normal case).
    // Falls back to --session-id only on first cold start (session not in Claude's storage).
    // Prompt is always passed as CLI argument — no tmux key delivery needed.
    // Inner script runs Claude; outer launcher wraps with script(1) for real-time PTY output
    // so tmux capture-pane (God View) can see output while also logging to file.
    const launcherScript = join(agentDir, 'launcher.sh');
    const innerScript = join(agentDir, 'run-claude.sh');

    // Inner script: the actual Claude invocation.
    // Non-reviewer specialist dispatches start fresh — no --resume. Reasons:
    // 1. Context compaction corrupts thinking block signatures, making resumed sessions
    //    permanently fail with "Invalid signature in thinking block" (PAN-612)
    // 2. These dispatches are task-based: each is a new task with a full prompt
    // 3. Accumulated context caused false-FAILs in test-agent (stale analysis)
    // Session ID is randomized per dispatch so JSONL files don't collide.
    //
    // Reviewers (review-correctness/security/performance/requirements/synthesis)
    // do NOT go through this path. They use PAN-830 canonical sessions in
    // review-agent.ts that persist across rounds via tmux send-keys delivery
    // — the Claude process stays alive between rounds so context (codebase
    // patterns, prior findings, decisions) is preserved without --resume.

    // Caveman env exports for this specialist type.
    // inspect-agent is excluded: its INSPECTION PASSED/BLOCKED sentinels are parsed
    // by Cloister and must not be compressed.
    const specialistCavemanExports = await buildSpecialistCavemanExports(
      specialistType,
      task.workspace,
      loadYamlConfig().config.caveman
    );

    const providerExportLines = buildProviderExportLines(providerEnv);
    writeFileSync(
      innerScript,
      generateLauncherScript({
        agentType: 'specialist-dispatch',
        workingDir: cwd,
        setPipefail: true,
        setTerminalEnv: true,
        unsetProviderEnv: true,
        providerExports: providerExportLines,
        setCi: true,
        panopticonEnv: { agentId: tmuxSession, issueId: task.issueId, sessionType: sessionTypeLabel },
        cavemanExports: specialistCavemanExports,
        promptFile,
        baseCommand: await resolveSpecialistBaseCommand(specialistType, model),
        permissionFlags: permissionFlags.split(' '),
        sessionId,
        model,
      }),
      { mode: 0o755 },
    );

    // Outer launcher: exec into script(1) so the tmux pane's main process IS script.
    // CRITICAL: must use `exec` (not a pipeline) so tmux kill-session SIGHUP propagates
    // through script -> child bash -> claude. The previous `script ... | tee LOG` form
    // left script + bash + claude as orphans whenever the launcher bash was killed,
    // because bash does NOT forward SIGHUP to non-job-controlled pipeline children.
    // script's positional arg writes the typescript directly to LOGFILE (in append mode
    // via -a), so we get the same log capture as the old tee pipeline without the pipe.
    // -q quiet (no Script started/done banners), -f flush on every write, -a append,
    // -e propagate child exit code, -c run command.
    const wrapper = generateLauncherWrapper({
      agentType: 'specialist-dispatch',
      workingDir: cwd,
      useScriptWrapper: true,
      scriptLogFile: logFilePath,
      innerScriptPath: innerScript,
    });
    if (!wrapper) {
      throw new Error('specialist wrapper requires useScriptWrapper + scriptLogFile');
    }
    writeFileSync(
      launcherScript,
      wrapper,
      { mode: 0o755 },
    );

    // Spawn Claude Code via launcher script (with provider env vars)
    // -c sets tmux session working directory to project path (prevents trust prompt — PAN-384)
    // Kill stale session first to prevent "duplicate session" error (PAN-430)
    await killSessionAsync(tmuxSession).catch(() => { /* no stale session */ });
    await execAsync(
      `${buildTmuxCommandString(['new-session', '-d', '-s', tmuxSession, '-c', cwd])}${envFlags} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    // Set state to active
    const { saveAgentRuntimeState } = await import('../agents.js');
    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: task.issueId,
    });

    console.log(`[claude-invoke] SUCCESS purpose=specialist-dispatch | model=${model} | source=specialists.ts:dispatchSpecialist | session=${tmuxSession} | specialist=${specialistType} | issue=${task.issueId} | run=${runId}`);


    return {
      success: true,
      runId,
      tmuxSession,
      message: `Spawned specialist ${specialistType} for ${task.issueId}`,
    };
  } catch (error: any) {
    console.error(`[specialist] Failed to spawn ${specialistType}:`, error);

    // Clean up metadata
    setCurrentRun(projectKey, registryKey, null);

    return {
      success: false,
      message: `Failed to spawn specialist: ${error.message}`,
      error: error.message,
    };
  }
}

/**
 * Shared test-agent prompt builder — used by both buildTaskPrompt (ephemeral spawn)
 * and wakeSpecialistWithTask (queue-based wake). Extracted to avoid the bug where
 * ephemeral test specialists got empty prompts (PAN-511).
 */
export async function buildTestAgentPromptContent(task: {
  issueId: string;
  branch?: string;
  workspace?: string;
}): Promise<string> {
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  const testWorkspace = task.workspace || 'unknown';
  const testGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
  const testIsPolyrepo = testGitInfo.isPolyrepo;

  const { extractTeamPrefix, findProjectByTeam } = await import('../projects.js');
  const testTeamPrefix = extractTeamPrefix(task.issueId);
  const testProjectConfig = testTeamPrefix ? findProjectByTeam(testTeamPrefix) : null;
  const testConfigs = testProjectConfig?.tests;

  let testCommands = '';
  let baselineCommands = '';
  const featureName = task.issueId.toLowerCase();
  const mainWorkspacePath = testWorkspace.replace(/workspaces\/feature-[^/]+/, 'workspaces/main');
  const projectRootPath = testProjectConfig?.path || testWorkspace.replace(/\/workspaces\/.*/, '');

  if (testConfigs && Object.keys(testConfigs).length > 0) {
    const testEntries = Object.entries(testConfigs);
    const testSuites: string[] = [];
    const baselineSuites: string[] = [];
    for (const [name, cfg] of testEntries) {
      const testDir = testIsPolyrepo
        ? `${testWorkspace}/${cfg.path}`
        : (cfg.path === '.' ? testWorkspace : `${testWorkspace}/${cfg.path}`);
      const baseDir = testIsPolyrepo
        ? `${mainWorkspacePath}/${cfg.path}`
        : (cfg.path === '.' ? mainWorkspacePath : `${mainWorkspacePath}/${cfg.path}`);
      const fallbackDir = cfg.path === '.' ? projectRootPath : `${projectRootPath}/${cfg.path}`;
      testSuites.push(`echo "\\n=== Test suite: ${name} (${cfg.type}) ===" && cd "${testDir}" && ${cfg.command} 2>&1; echo "EXIT_CODE_${name}: $?"`);
      baselineSuites.push(`echo "\\n=== Baseline: ${name} (${cfg.type}) ===" && cd "${baseDir}" 2>/dev/null && ${cfg.command} 2>&1 || (cd "${fallbackDir}" 2>/dev/null && ${cfg.command} 2>&1) || echo "BASELINE_SKIP_${name}: could not run baseline"; echo "EXIT_CODE_${name}: $?"`);
    }
    testCommands = testSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
    baselineCommands = baselineSuites.map((cmd, i) => `# Suite ${i + 1}\n${cmd}`).join('\n');
  } else if (testIsPolyrepo) {
    const testSuites: string[] = [];
    const baselineSuites: string[] = [];
    for (const gitDir of testGitInfo.gitDirs) {
      const repoName = basename(gitDir);
      testSuites.push(`echo "\\n=== ${repoName} ===" && cd "${gitDir}" && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
      const baseDir = `${mainWorkspacePath}/${repoName}`;
      baselineSuites.push(`echo "\\n=== Baseline: ${repoName} ===" && cd "${baseDir}" 2>/dev/null && if [ -f pom.xml ]; then ./mvnw test 2>&1; elif [ -f package.json ]; then npm test 2>&1; else echo "No test runner found"; fi; echo "EXIT_CODE_${repoName}: $?"`);
    }
    testCommands = testSuites.join('\n');
    baselineCommands = baselineSuites.join('\n');
  } else {
    testCommands = `cd "${testWorkspace}" && npm test 2>&1; echo "EXIT_CODE: $?"`;
    baselineCommands = `cd "${mainWorkspacePath}" 2>/dev/null && npm test 2>&1 || (cd "${projectRootPath}" && npm test 2>&1); echo "EXIT_CODE: $?"`;
  }

  const testConfigSummary = testConfigs
    ? Object.entries(testConfigs).map(([name, cfg]) => `- **${name}** (${cfg.type}): \`${cfg.command}\` in \`${cfg.path}/\``).join('\n')
    : testIsPolyrepo
      ? testGitInfo.gitDirs.map(d => `- **${basename(d)}**: auto-detected`).join('\n')
      : '- Single test suite at workspace root';

  const timeoutMs = testConfigs && Object.values(testConfigs).some(c => c.type === 'maven') ? '600000' : '300000';
  const multiSuite = testIsPolyrepo || (!!testConfigs && Object.keys(testConfigs).length > 1);
  const dnsDomain = testProjectConfig?.workspace?.dns?.domain || '';

  return renderPrompt({
    name: 'test',
    vars: {
      ISSUE_ID: task.issueId,
      BRANCH: task.branch || 'unknown',
      WORKSPACE: testWorkspace,
      IS_POLYREPO: testIsPolyrepo,
      TEST_COMMANDS: testCommands,
      BASELINE_COMMANDS: baselineCommands,
      TEST_CONFIG_SUMMARY: testConfigSummary,
      TIMEOUT_MS: timeoutMs,
      API_URL: apiUrl,
      FEATURE_NAME: featureName,
      DOCKER_PS_FORMAT: '{{.Names}} {{.Status}}',
      POLYREPO_DIRS: testIsPolyrepo ? testGitInfo.gitDirs.map(d => basename(d)).join(', ') : '',
      MULTI_SUITE: multiSuite,
      DNS_DOMAIN: dnsDomain,
    },
  });
}

/**
 * Build task prompt for a specialist
 */
async function buildTaskPrompt(
  projectKey: string,
  specialistType: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  },
  contextDigest: string | null
): Promise<string> {
  const { getSpecialistPromptOverride } = await import('../projects.js');
  const customPrompt = getSpecialistPromptOverride(projectKey, specialistType);

  let prompt = `# ${specialistType} Task - ${task.issueId}\n\n`;

  // Add context digest if available
  if (contextDigest) {
    prompt += `## Context from Recent Runs\n\n${contextDigest}\n\n`;
  }

  // Add custom project-specific prompt if configured
  if (customPrompt) {
    prompt += `## Project-Specific Guidelines\n\n${customPrompt}\n\n`;
  }

  // Add task details
  prompt += `## Current Task\n\n`;
  prompt += `Issue: ${task.issueId}\n`;
  if (task.branch) prompt += `Branch: ${task.branch}\n`;
  if (task.workspace) prompt += `Workspace: ${task.workspace}\n`;
  if (task.prUrl) prompt += `PR URL: ${task.prUrl}\n`;
  prompt += `\n`;

  // Add specialist-specific instructions
  switch (specialistType) {
    case 'review-agent': {
      const diffBase = (task.context?.targetBranch as string | undefined) || 'main';
      const workspace = task.workspace || 'unknown';
      const reviewGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const gitDirs = reviewGitInfo.gitDirs;
      const isPolyrepo = gitDirs.length > 1;
      const gitDir = gitDirs[0] || workspace;
      const gitDiffCommands = gitDirs.length > 0
        ? gitDirs.map(d => `cd "${d}" && git diff --name-only ${diffBase}...HEAD`).join('\n')
        : `cd "${workspace}" && git diff --name-only ${diffBase}...HEAD`;
      const gitDiffFileCmd = gitDirs.length > 0
        ? `cd "${gitDir}" && git diff ${diffBase}...HEAD -- <file>`
        : `cd "${workspace}" && git diff ${diffBase}...HEAD -- <file>`;
      const apiPort = process.env.API_PORT || process.env.PORT || '3011';
      const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;

      prompt += renderPrompt({
        name: 'review',
        vars: {
          ISSUE_ID: task.issueId,
          BRANCH: task.branch || 'unknown',
          WORKSPACE: workspace,
          DIFF_BASE: diffBase,
          IS_POLYREPO: isPolyrepo,
          GIT_DIFF_COMMANDS: gitDiffCommands,
          GIT_DIFF_FILE_CMD: gitDiffFileCmd,
          API_URL: apiUrl,
          PR_URL: task.prUrl || '',
          POLYREPO_DIRS: isPolyrepo ? gitDirs.map(d => basename(d)).join(', ') : '',
        },
      });
      break;
    }

    case 'test-agent': {
      // Delegate to shared test-agent prompt builder
      const testPrompt = await buildTestAgentPromptContent(task);
      prompt += testPrompt;
      break;
    }

    case 'merge-agent': {
      const bInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const apiPort = process.env.API_PORT || process.env.PORT || '3011';
      const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
      prompt += renderPrompt({
        name: 'merge',
        vars: {
          ISSUE_ID: task.issueId,
          SOURCE_BRANCH: bInfo.branch || task.branch || 'unknown',
          TARGET_BRANCH: 'main',
          PROJECT_PATH: task.workspace || 'unknown',
          DO_PUSH: false,
          DO_BUILD: false,
          API_URL: apiUrl,
          IS_POLYREPO: bInfo.isPolyrepo,
          POLYREPO_DIRS: bInfo.isPolyrepo ? bInfo.gitDirs.map(d => basename(d)).join(', ') : '',
          PR_URL: task.prUrl || '',
        },
      });
      break;
    }

    case 'inspect-agent': {
      const workspace = task.workspace || 'unknown';
      const beadId = (task.context?.beadId as string | undefined) || 'unknown';
      const checkpoint = (task.context?.checkpoint as string | undefined) || 'main';
      const diffStats = (task.context?.diffStats as string | undefined) || '';
      const beadDescription = (task.context?.beadDescription as string | undefined) || 'Bead description not available';
      const diffBase = checkpoint;

      prompt += renderPrompt({
        name: 'inspect-agent',
        vars: {
          ISSUE_ID: task.issueId,
          BEAD_ID: beadId,
          WORKSPACE_PATH: workspace,
          PROJECT_PATH: workspace,
          CHECKPOINT: checkpoint,
          DIFF_BASE: diffBase,
          DIFF_STATS: diffStats,
          BEAD_DESCRIPTION: beadDescription,
        },
      });
      break;
    }

    case 'uat-agent': {
      const workspace = task.workspace || 'unknown';
      const apiPort = process.env.API_PORT || process.env.PORT || '3011';
      const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
      const frontendUrl = process.env.FRONTEND_URL || `http://localhost:5173`; // Vite default
      const testTokenApi = process.env.TEST_TOKEN_API || 'myn_test_e2e'; // Default for MYN

      prompt += renderPrompt({
        name: 'uat-agent',
        vars: {
          ISSUE_ID: task.issueId,
          WORKSPACE: workspace,
          FRONTEND_URL: frontendUrl,
          API_URL: apiUrl,
          TEST_TOKEN_API: testTokenApi,
          VIEWPORT_CONFIGS: 'desktop: 1920x1080, tablet: 768x1024, mobile: 375x667',
        },
      });
      break;
    }
  }

  prompt += `\n\nWhen you complete your task, report your findings and status.`;

  return prompt;
}

/**
 * Start grace period for a specialist
 *
 * @param projectKey - Project identifier
 * @param specialistType - Specialist type
 * @param duration - Grace period duration in milliseconds (default: 60000)
 */
export function startGracePeriod(
  projectKey: string,
  specialistType: SpecialistType,
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
export function pauseGracePeriod(projectKey: string, specialistType: SpecialistType): boolean {
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
export function resumeGracePeriod(projectKey: string, specialistType: SpecialistType): boolean {
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
export function exitGracePeriod(projectKey: string, specialistType: SpecialistType): void {
  const key = `${projectKey}-${specialistType}`;
  gracePeriodStates.delete(key);

  terminateSpecialist(projectKey, specialistType);
}

/**
 * Get grace period state
 */
export function getGracePeriodState(
  projectKey: string,
  specialistType: SpecialistType
): GracePeriodState | null {
  const key = `${projectKey}-${specialistType}`;
  return gracePeriodStates.get(key) || null;
}

/**
 * Find the active registry key for (projectKey, specialistType).
 * Searches compound keys; falls back to plain specialistType key.
 * Returns undefined if nothing is currently active.
 */
export function findActiveRegistryKey(projectKey: string, specialistType: SpecialistType): string | undefined {
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
  specialistType: SpecialistType,
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
  specialistType: SpecialistType,
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
function scheduleLogCleanup(projectKey: string, specialistType: SpecialistType): void {
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
export function getProjectSpecialistDir(projectKey: string, specialistType: SpecialistType): string {
  return join(SPECIALISTS_DIR, projectKey, specialistType);
}

/**
 * Ensure per-project specialist directory structure exists
 */
export function ensureProjectSpecialistDir(projectKey: string, specialistType: SpecialistType): void {
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
  specialistType: SpecialistType
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
  specialistType: SpecialistType,
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
export function listSpecialistsForProject(projectKey: string): SpecialistType[] {
  const registry = loadRegistry();
  const project = registry.projects[projectKey];

  if (!project) {
    return [];
  }

  return Object.keys(project) as SpecialistType[];
}

/**
 * Get all per-project specialist statuses (PAN-754: compound-key aware).
 * Walks registry including compound keys (type:issueId[:role]) and returns
 * enriched entries with issueId, model, currentActivity for the Agents page.
 */
export async function getAllProjectSpecialistStatuses(): Promise<Array<{
  projectKey: string;
  specialistType: SpecialistType;
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
    specialistType: SpecialistType;
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
        ?? getTmuxSessionName(specialistType as SpecialistType, projectKey, issueId);

      const runtimeState = getAgentRuntimeState(tmuxSession);
      const sessionRunning = await isRunning(specialistType as SpecialistType, projectKey).catch(() => false);
      const running = isProjectSpecialistActivelyRunning(runtimeState, sessionRunning);
      const effectiveMetadata = running ? metadata : { ...metadata, currentRun: null };

      results.push({
        projectKey,
        specialistType: specialistType as SpecialistType,
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
export function updateContextTokens(name: SpecialistType, tokens: number): void {
  updateSpecialistMetadata(name, { contextTokens: tokens });
}

/**
 * List all session files in the specialists directory
 *
 * @returns Array of specialist names that have session files
 */
export function listSessionFiles(): SpecialistType[] {
  initSpecialistsDirectory();

  try {
    const files = readdirSync(SPECIALISTS_DIR);
    const sessionFiles = files.filter((f) => f.endsWith('.session'));

    return sessionFiles.map((f) => f.replace('.session', '') as SpecialistType);
  } catch (error) {
    console.error('Failed to list session files:', error);
    return [];
  }
}

/**
 * Enable a specialist
 *
 * @param name - Specialist name
 */
export function enableSpecialist(name: SpecialistType): void {
  updateSpecialistMetadata(name, { enabled: true });
}

/**
 * Disable a specialist
 *
 * @param name - Specialist name
 */
export function disableSpecialist(name: SpecialistType): void {
  updateSpecialistMetadata(name, { enabled: false });
}

/**
 * Check if a specialist is enabled
 *
 * @param name - Specialist name
 * @returns True if specialist is enabled
 */
export function isEnabled(name: SpecialistType): boolean {
  const metadata = getSpecialistMetadata(name);
  return metadata?.enabled ?? false;
}

/**
 * Get all enabled specialists
 *
 * @returns Array of enabled specialists
 */
export function getEnabledSpecialists(): SpecialistMetadata[] {
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
export function countContextTokens(name: SpecialistType): number | null {
  const sessionId = getSessionId(name);

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
export async function isRunning(name: SpecialistType, projectKey?: string): Promise<boolean> {
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
  name: SpecialistType,
  projectKey?: string
): Promise<SpecialistStatus> {
  const metadata = getSpecialistMetadata(name) || {
    name,
    displayName: name,
    description: '',
    enabled: false,
    autoWake: false,
  };

  const sessionId = getSessionId(name, projectKey);
  const running = await isRunning(name, projectKey);
  const contextTokens = countContextTokens(name);

  // Determine state from hook-based runtime state (PAN-80)
  const { getAgentRuntimeState } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name, projectKey);
  const runtimeState = getAgentRuntimeState(tmuxSession);

  let state: SpecialistState;
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
export async function getAllSpecialistStatus(): Promise<SpecialistStatus[]> {
  const specialists = getAllSpecialists();
  return Promise.all(specialists.map((metadata) => getSpecialistStatus(metadata.name)));
}

/**
 * Initialize a specialist agent
 *
 * Creates a tmux session and starts Claude Code with an identity prompt.
 * This is for first-time initialization of specialists that don't have session files.
 *
 * @param name - Specialist name
 * @returns Promise with initialization result
 */
export async function initializeSpecialist(name: SpecialistType): Promise<{
  success: boolean;
  message: string;
  tmuxSession?: string;
  error?: string;
}> {
  // Check if already running
  if (await isRunning(name)) {
    return {
      success: false,
      message: `Specialist ${name} is already running`,
      error: 'already_running',
    };
  }

  // Check if already initialized
  if (getSessionId(name)) {
    return {
      success: false,
      message: `Specialist ${name} is already initialized. Use wake to start it.`,
      error: 'already_initialized',
    };
  }

  const tmuxSession = getTmuxSessionName(name);
  const cwd = getDevrootPath() || homedir();

  // Determine model for this specialist using work type router
  let model = 'claude-sonnet-4-6'; // default fallback
  try {
    // Map specialist name to work type ID
    const workTypeId: WorkTypeId = `specialist-${name}` as WorkTypeId;
    model = getModelId(workTypeId);
  } catch (error) {
    console.warn(`Warning: Could not resolve model for ${name}, using default model`);
  }

  // Create identity prompt for the specialist
  const role =
    name === 'merge-agent' ? 'Resolve merge conflicts and ensure clean integrations' :
    name === 'review-agent' ? 'Review code changes and provide quality feedback' :
    name === 'test-agent' ? 'Execute and analyze test results' :
    'Assist with development tasks';
  const identityPrompt = renderPrompt({
    name: 'identity-wake',
    vars: { SPECIALIST_NAME: name, ROLE: role },
  });

  try {
    // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
    const providerEnv = await getProviderEnvForModel(model);
    const envFlags = buildTmuxEnvFlags(providerEnv);

    // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
    // For all other providers, clear stale apiKeyHelper from previous runs.
    const providerCfg = getProviderForModel(model as ModelId);
    if (providerCfg.authType === 'credential-file') {
      setupCredentialFileAuth(providerCfg, cwd);
    } else {
      clearCredentialFileAuth(cwd);
    }

    // Write identity prompt and launcher script to avoid shell escaping issues
    const agentDir = join(homedir(), '.panopticon', 'agents', tmuxSession);
    await execAsync(`mkdir -p "${agentDir}"`, { encoding: 'utf-8' });

    const promptFile = join(agentDir, 'identity-prompt.md');
    const launcherScript = join(agentDir, 'launcher.sh');

    writeFileSync(promptFile, identityPrompt);
    const newSessionId = randomUUID();
    const initProviderExportLines = buildProviderExportLines(providerEnv);
    writeFileSync(
      launcherScript,
      generateLauncherScript({
        agentType: 'specialist-init',
        workingDir: cwd,
        unsetProviderEnv: true,
        providerExports: initProviderExportLines,
        promptFile,
        baseCommand: await resolveSpecialistBaseCommand(name, model),
        permissionFlags: ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'],
        sessionId: newSessionId,
        model,
      }),
      { mode: 0o755 },
    );
    setSessionId(name, newSessionId);

    // Pre-trust cwd so specialists don't hit the trust prompt (same as spawnSpecialist)
    try {
      const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
      preTrustDirectory(cwd);
    } catch { /* non-fatal */ }

    // Spawn Claude Code via launcher script (with provider env vars)
    // -c sets tmux session working directory to project path (prevents trust prompt)
    // Kill stale session first to prevent "duplicate session" error (PAN-430)
    await killSessionAsync(tmuxSession).catch(() => { /* no stale session */ });
    await execAsync(
      `${buildTmuxCommandString(['new-session', '-d', '-s', tmuxSession, '-c', cwd])}${envFlags} "bash '${launcherScript}'"`,
      { encoding: 'utf-8' }
    );

    // Record wake event
    recordWake(name);

    return {
      success: true,
      message: `Specialist ${name} initialized and started`,
      tmuxSession,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to initialize specialist ${name}: ${errorMessage}`,
      error: errorMessage,
    };
  }
}

/**
 * Initialize all enabled but uninitialized specialists
 *
 * Called during Cloister startup to ensure specialists are ready.
 *
 * @returns Promise with array of initialization results
 */
export async function initializeEnabledSpecialists(): Promise<Array<{
  name: SpecialistType;
  success: boolean;
  message: string;
}>> {
  const enabled = getEnabledSpecialists();
  const results: Array<{ name: SpecialistType; success: boolean; message: string }> = [];

  for (const specialist of enabled) {
    const sessionId = getSessionId(specialist.name);

    if (!sessionId) {
      // Specialist is enabled but not initialized
      console.log(`  → Auto-initializing specialist: ${specialist.name}`);
      const result = await initializeSpecialist(specialist.name);
      results.push({
        name: specialist.name,
        success: result.success,
        message: result.message,
      });

      // Small delay between initializations to avoid overwhelming the system
      if (results.length < enabled.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } else {
      results.push({
        name: specialist.name,
        success: true,
        message: `Already initialized with session ${sessionId.substring(0, 8)}...`,
      });
    }
  }

  return results;
}

/**
 * Reset specialist state before sending a new task
 *
 * Clears stale state from previous tasks:
 * 1. Sends Ctrl+C to cancel any pending command
 * 2. Runs 'cd ~' to reset working directory
 * 3. Sends Ctrl+U to clear the prompt buffer
 *
 * @param name - Specialist name
 */
async function resetSpecialist(name: SpecialistType): Promise<void> {
  const tmuxSession = getTmuxSessionName(name);

  try {
    // 1. Cancel any pending command with Ctrl+C and wait for Claude to return to idle.
    //    Do NOT send 'cd ~' here — that triggers LLM inference (2-5s) and creates a race:
    //    the task message arrives while Claude is still processing the cd command and gets lost.
    await execAsync(buildTmuxCommandString(['send-keys', '-t', tmuxSession, 'C-c']), { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 500));

    // 2. Clear any partial input on the prompt line
    await execAsync(buildTmuxCommandString(['send-keys', '-t', tmuxSession, 'C-u']), { encoding: 'utf-8' });
    await new Promise(resolve => setTimeout(resolve, 100));
  } catch (error) {
    console.error(`[specialist] Failed to reset ${name}:`, error);
    // Non-fatal - continue with wake
  }
}

/**
 * Wake a specialist to process a task
 *
 * Sends a task prompt to a running specialist. If the specialist isn't running,
 * starts it first (with --resume if it has a session).
 *
 * @param name - Specialist name
 * @param taskPrompt - The task prompt to send to the specialist
 * @param options - Additional options
 * @returns Promise with wake result
 */
export async function wakeSpecialist(
  name: SpecialistType,
  taskPrompt: string,
  options: {
    waitForReady?: boolean; // Wait for agent to be ready before sending prompt (default: true)
    startIfNotRunning?: boolean; // Start the agent if not running (default: true)
    issueId?: string; // Issue ID being worked on (for tracking)
    skipBusyGuard?: boolean; // Skip busy check (caller already verified idle + set active)
  } = {}
): Promise<{
  success: boolean;
  message: string;
  tmuxSession?: string;
  wasAlreadyRunning: boolean;
  error?: string;
}> {
  const { waitForReady = true, startIfNotRunning = true, issueId } = options;
  const tmuxSession = getTmuxSessionName(name);
  const sessionId = getSessionId(name);
  const wasAlreadyRunning = await isRunning(name);

  // Guard: if specialist is running and busy, refuse to send a new task.
  // Sending a message to a busy Claude session causes "Interrupted" behavior —
  // the running tool is cancelled and the previous task is abandoned mid-flight.
  // Callers should use wakeSpecialistOrQueue() for automatic busy handling.
  // Skip this guard when called from wakeSpecialistOrQueue (skipBusyGuard),
  // since the caller already verified idle state and pre-set active to prevent races.
  if (wasAlreadyRunning && !options.skipBusyGuard) {
    const { getAgentRuntimeState } = await import('../agents.js');
    const runtimeState = getAgentRuntimeState(tmuxSession);
    if (runtimeState?.state === 'active') {
      console.warn(`[specialist] ${name} is busy (working on ${runtimeState.currentIssue}), refusing to interrupt`);
      return {
        success: false,
        message: `Specialist ${name} is busy (working on ${runtimeState.currentIssue}). Use wakeSpecialistOrQueue() instead.`,
        tmuxSession,
        wasAlreadyRunning: true,
        error: 'specialist_busy',
      };
    }
  }

  // If not running, start it first
  if (!wasAlreadyRunning) {
    if (!startIfNotRunning) {
      return {
        success: false,
        message: `Specialist ${name} is not running`,
        wasAlreadyRunning: false,
        error: 'not_running',
      };
    }

    // Use devroot (~/Projects) — already trusted in Claude Code
    const cwd = getDevrootPath() || join(process.env.HOME || '/home/eltmon', 'Projects');

    // Pre-trust cwd so specialists don't hit the trust prompt
    try {
      const { preTrustDirectory } = await import('../workspace-manager.js') as { preTrustDirectory: (dir: string) => void };
      preTrustDirectory(cwd);
    } catch { /* non-fatal */ }

    try {
      // Resolve model from work type router (respects config.yaml overrides)
      let model = 'claude-sonnet-4-6'; // default fallback
      try {
        const workTypeId: WorkTypeId = `specialist-${name}` as WorkTypeId;
        model = getModelId(workTypeId);
      } catch (error) {
        console.warn(`[specialist] Could not resolve model for ${name}, using default`);
      }
      const modelFlag = `--model ${model}`;

      // Get provider-specific env vars (BASE_URL, AUTH_TOKEN) for non-Anthropic models
      const providerEnv = await getProviderEnvForModel(model);
      // Add Panopticon cost attribution env vars
      const wakeSessionType = name.replace('-agent', ''); // review-agent → review
      const wakePanEnv: Record<string, string> = {
        PANOPTICON_AGENT_ID: tmuxSession,
        PANOPTICON_SESSION_TYPE: wakeSessionType,
      };
      if (issueId) {
        wakePanEnv.PANOPTICON_ISSUE_ID = issueId;
      }
      const terminalEnv: Record<string, string> = {
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      };
      const envFlags = buildTmuxEnvFlags({ ...terminalEnv, ...providerEnv, ...wakePanEnv });

      // For credential-file providers (e.g. Kimi), configure apiKeyHelper for token refresh.
      // For all other providers, clear stale apiKeyHelper from previous runs.
      const provCfg = getProviderForModel(model as ModelId);
      if (provCfg.authType === 'credential-file') {
        setupCredentialFileAuth(provCfg, cwd);
      } else {
        clearCredentialFileAuth(cwd);
      }

      // All autonomous specialists need full permission bypass to avoid interactive prompts
      const permissionFlags = '--dangerously-skip-permissions --permission-mode bypassPermissions';

      // Start with --resume if we have a session, otherwise generate a new session ID
      // Always start fresh — no --resume. Context compaction corrupts thinking block
      // signatures, making resumed sessions permanently fail (PAN-612).
      const effectiveSessionId = sessionId || randomUUID();
      if (!sessionId) setSessionId(name, effectiveSessionId);
      const providerExportCmd = Object.entries(providerEnv)
        .map(([k, v]) => `export ${k}="${v}"`)
        .join('; ');
      const providerSetupCmd = providerExportCmd ? `${providerExportCmd}; ` : '';
      const claudeCmd = `${PROVIDER_UNSET_CMD}; ${providerSetupCmd}export TERM=xterm-256color; export COLORTERM=truecolor; exec claude --session-id "${effectiveSessionId}" ${modelFlag} ${permissionFlags}`;
      console.log(`[claude-invoke] purpose=specialist-wake | model=${model} | source=specialists.ts:wakeSpecialist | session=${tmuxSession} | specialist=${name} | command="exec claude ..."`);

      // Kill stale session first to prevent "duplicate session" error (PAN-430)
      await killSessionAsync(tmuxSession).catch(() => { /* no stale session */ });
      await execAsync(
        `${buildTmuxCommandString(['new-session', '-d', '-s', tmuxSession, '-c', cwd])}${envFlags} "${claudeCmd}"`,
        { encoding: 'utf-8' }
      );

      if (waitForReady) {
        // Poll for Claude's interactive prompt instead of fixed sleep.
        // Fresh starts can take 5-10s; 15s timeout covers slow models.
        const ready = await waitForClaudePrompt(tmuxSession, 15000);
        if (!ready) {
          console.warn(`[specialist] ${name}: prompt not detected within 15s, proceeding anyway`);
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to start specialist ${name}: ${msg}`,
        wasAlreadyRunning: false,
        error: msg,
      };
    }
  }

  // Reset specialist state to clear stale context from previous tasks
  await resetSpecialist(name);

  // Wait for Claude to be at its interactive prompt before sending the task.
  // For already-running specialists this should be near-instant; for freshly-started
  // ones the waitForReady above already waited, but resetSpecialist's C-c may have
  // interrupted something so we re-confirm here.
  const promptReady = await waitForClaudePrompt(tmuxSession, wasAlreadyRunning ? 5000 : 15000);
  if (!promptReady) {
    console.warn(`[specialist] ${name}: prompt not detected after reset, proceeding anyway`);
  }

  // Send the task prompt
  try {
    // For large prompts (>500 chars or multiline), write to file to avoid tmux paste issues
    // Tmux send-keys with large text shows as "[Pasted text #1 +N lines]" which Claude doesn't process
    const isLargePrompt = taskPrompt.length > 500 || taskPrompt.includes('\n');

    // Prepare the message to send
    let messageToSend: string;
    if (isLargePrompt) {
      if (!existsSync(TASKS_DIR)) {
        mkdirSync(TASKS_DIR, { recursive: true });
      }
      const taskFile = join(TASKS_DIR, `${name}-${Date.now()}.md`);
      writeFileSync(taskFile, taskPrompt, 'utf-8');
      messageToSend = `Read and execute the task in: ${taskFile}`;
    } else {
      messageToSend = taskPrompt;
    }

    // Snapshot tmux output BEFORE sending so we can detect new activity
    const outputBefore = await capturePaneAsync(tmuxSession, 50);

    // Send the task message
    await sendKeysAsync(tmuxSession, messageToSend);

    // Verify Claude received the message by watching for new output (tool calls, responses).
    // This catches silent delivery failures — the structural root cause of lost tasks.
    const delivered = await confirmDelivery(tmuxSession, outputBefore, 10000);
    if (!delivered) {
      console.warn(`[specialist] ${name}: no activity detected after task send, retrying...`);
      // Re-snapshot and retry once
      const retryBefore = await capturePaneAsync(tmuxSession, 50);
      await sendKeysAsync(tmuxSession, messageToSend);
      const retryDelivered = await confirmDelivery(tmuxSession, retryBefore, 10000);
      if (!retryDelivered) {
        return {
          success: false,
          message: `Task message not received by specialist ${name} after retry`,
          tmuxSession,
          wasAlreadyRunning,
          error: 'delivery_failed',
        };
      }
    }

    // Record wake event
    recordWake(name, sessionId || undefined);

    // Set state to active immediately (PAN-80: spinner should show right away)
    const { saveAgentRuntimeState } = await import('../agents.js');
    saveAgentRuntimeState(tmuxSession, {
      state: 'active',
      lastActivity: new Date().toISOString(),
      currentIssue: issueId,
    });

    return {
      success: true,
      message: wasAlreadyRunning
        ? `Sent task to running specialist ${name}`
        : `Started specialist ${name} and sent task`,
      tmuxSession,
      wasAlreadyRunning,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to send task to specialist ${name}: ${msg}`,
      tmuxSession,
      wasAlreadyRunning,
      error: msg,
    };
  }
}

/**
 * Wake specialist with a task from the queue
 *
 * Convenience wrapper that formats task details into a prompt.
 *
 * @param name - Specialist name
 * @param task - Task from the queue
 * @returns Promise with wake result
 */
export async function wakeSpecialistWithTask(
  name: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  },
  options: { skipBusyGuard?: boolean } = {}
): Promise<ReturnType<typeof wakeSpecialist>> {
  // Build context-aware prompt based on specialist type and task
  const apiPort = process.env.API_PORT || process.env.PORT || '3011';
  const apiUrl = process.env.DASHBOARD_URL || `http://localhost:${apiPort}`;
  let prompt: string;

  switch (name) {
    case 'merge-agent': {
      const mergeWorkspace = task.workspace || 'unknown';
      const mergeInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const mergeBranch = mergeInfo.branch;

      prompt = renderPrompt({
        name: 'merge',
        vars: {
          ISSUE_ID: task.issueId,
          SOURCE_BRANCH: mergeBranch || 'unknown',
          TARGET_BRANCH: 'main',
          PROJECT_PATH: mergeWorkspace,
          DO_PUSH: false,
          DO_BUILD: false,
          API_URL: apiUrl,
          IS_POLYREPO: mergeInfo.isPolyrepo,
          POLYREPO_DIRS: mergeInfo.isPolyrepo ? mergeInfo.gitDirs.map(d => basename(d)).join(', ') : '',
          PR_URL: task.prUrl || '',
        },
      });
      break;
    }

    case 'review-agent': {
      const diffBase = (task.context?.targetBranch as string | undefined) || 'main';
      // Pre-check: detect stale branch (0 diff from main) before waking the agent
      const workspace = task.workspace || 'unknown';

      // Resolve git directories and branch from workspace
      const reviewGitInfo = await resolveWorkspaceGitInfo(task.workspace, task.branch);
      const gitDirs = reviewGitInfo.gitDirs;
      // Use first git dir for pre-check (primary repo), fall back to workspace root
      const gitDir = gitDirs[0] || workspace;

      let staleBranch = false;
      if (workspace !== 'unknown' && gitDirs.length > 0) {
        try {
          // For polyrepos, check all git dirs — if ANY has changes, it's not stale
          let totalChangedFiles = 0;
          for (const dir of gitDirs) {
            const { stdout: dirDiff } = await execAsync(
              `cd "${dir}" && git fetch origin ${diffBase} 2>/dev/null; git diff --name-only ${diffBase}...HEAD 2>/dev/null`,
              { encoding: 'utf-8', timeout: 15000 }
            );
            totalChangedFiles += dirDiff.trim().split('\n').filter((f: string) => f.length > 0).length;
          }
          if (totalChangedFiles === 0) {
            staleBranch = true;
            console.log(`[specialist] review-agent: stale branch detected for ${task.issueId} — 0 files changed vs ${diffBase}`);

            // Auto-complete the review: set reviewStatus to passed
            const { setReviewStatus } = await import('../review-status.js');
            setReviewStatus(task.issueId.toUpperCase(), {
              reviewStatus: 'passed',
              reviewNotes: `No changes to review — branch identical to ${diffBase} (already merged or stale)`,
            });
            console.log(`[specialist] review-agent: auto-passed ${task.issueId} (stale branch)`);

            // Also try to signal via the specialists/done path for idle state management
            const tmuxSession = getTmuxSessionName('review-agent');
            const { saveAgentRuntimeState } = await import('../agents.js');
            saveAgentRuntimeState(tmuxSession, {
              state: 'idle',
              lastActivity: new Date().toISOString(),
            });

            return { success: true, message: `Stale branch auto-passed for ${task.issueId}`, wasAlreadyRunning: false, error: undefined };
          }
        } catch (err) {
          // If pre-check fails, fall through to normal wake — agent will handle it
          console.warn(`[specialist] review-agent: stale branch pre-check failed for ${task.issueId}:`, err);
        }
      }

      // Build git commands for the prompt — polyrepo workspaces need git commands in subdirectories
      const isPolyrepo = gitDirs.length > 1;
      const gitDiffCommands = gitDirs.length > 0
        ? gitDirs.map(d => `cd "${d}" && git diff --name-only ${diffBase}...HEAD`).join('\n')
        : `cd "${workspace}" && git diff --name-only ${diffBase}...HEAD`;
      const gitDiffFileCmd = gitDirs.length > 0
        ? `cd "${gitDir}" && git diff ${diffBase}...HEAD -- <file>`
        : `cd "${workspace}" && git diff ${diffBase}...HEAD -- <file>`;

      prompt = renderPrompt({
        name: 'review',
        vars: {
          ISSUE_ID: task.issueId,
          BRANCH: task.branch || 'unknown',
          WORKSPACE: workspace,
          DIFF_BASE: diffBase,
          IS_POLYREPO: isPolyrepo,
          GIT_DIFF_COMMANDS: gitDiffCommands,
          GIT_DIFF_FILE_CMD: gitDiffFileCmd,
          API_URL: apiUrl,
          PR_URL: task.prUrl || '',
          POLYREPO_DIRS: isPolyrepo ? gitDirs.map(d => basename(d)).join(', ') : '',
        },
      });
      break;
    }

    case 'test-agent': {
      prompt = await buildTestAgentPromptContent(task);
      break;
    }

    default:
      prompt = `Task for ${task.issueId}: Please process this task and report findings.`;
  }

  return wakeSpecialist(name, prompt, { issueId: task.issueId, skipBusyGuard: options.skipBusyGuard });
}

/**
 * Task context interface for handoffs and specialist tasks
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
 * Wake a specialist, returning specialist_busy if currently active.
 *
 * This wrapper checks if the specialist is busy before waking.
 * If the specialist is running but not idle, returns error: 'specialist_busy'
 * — callers should set dispatch_failed so the deacon can retry on the next patrol.
 *
 * @param name - Specialist name
 * @param task - Task details
 * @param priority - Task priority (default: 'normal')
 * @param source - Source of the task (default: 'handoff')
 * @returns Promise with result indicating success or busy error
 */
export async function wakeSpecialistOrQueue(
  name: SpecialistType,
  task: {
    issueId: string;
    branch?: string;
    workspace?: string;
    prUrl?: string;
    context?: TaskContext;
  },
  options: {
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    source?: string;
  } = {}
): Promise<{
  success: boolean;
  queued: boolean;
  message: string;
  error?: string;
}> {
  const { priority = 'normal', source = 'handoff' } = options;

  // DAG-aware readiness gate: if a vBRIEF item ID is provided in context,
  // check that all its blocking dependencies are completed before scheduling.
  // This prevents scheduling work whose dependencies aren't done yet.
  const vbriefItemId = task.context?.vbriefItemId as string | undefined;
  const workspacePath = task.workspace || (task.context?.workspace as string | undefined);
  if (vbriefItemId && workspacePath) {
    try {
      if (!isTaskReady(vbriefItemId, workspacePath)) {
        return {
          success: false,
          queued: false,
          message: `Task "${vbriefItemId}" has incomplete blocking dependencies — not ready to schedule`,
        };
      }
    } catch (readinessErr: any) {
      // Non-fatal: proceed if readiness check fails
      console.warn(`[specialist] Task readiness check failed for ${vbriefItemId}: ${readinessErr.message}`);
    }
  }

  // Check if specialist is running and get state (PAN-80)
  const running = await isRunning(name);
  const { getAgentRuntimeState } = await import('../agents.js');
  const tmuxSession = getTmuxSessionName(name);
  const runtimeState = getAgentRuntimeState(tmuxSession);
  const idle = runtimeState?.state === 'idle' || runtimeState?.state === 'suspended';

  // If running and busy (active), return specialist_busy — callers handle retry
  if (running && !idle) {
    console.log(`[specialist] ${name} busy for ${task.issueId} — caller should retry or deacon will recover`);
    return {
      success: false,
      queued: false,
      message: `Specialist ${name} is busy. Deacon will retry on next patrol.`,
      error: 'specialist_busy',
    };
  }

  // Otherwise, wake the specialist directly
  // PAN-88: Set state to 'active' IMMEDIATELY to prevent race conditions
  // This must happen BEFORE the actual wake to block concurrent requests
  const { saveAgentRuntimeState } = await import('../agents.js');
  saveAgentRuntimeState(tmuxSession, {
    state: 'active',
    lastActivity: new Date().toISOString(),
    currentIssue: task.issueId,
  });
  console.log(`[specialist] ${name} marked active (preventing concurrent wakes)`);

  try {
    const wakeResult = await wakeSpecialistWithTask(name, task, { skipBusyGuard: true });

    if (!wakeResult.success) {
      // Wake failed - revert state to idle and clear currentIssue
      saveAgentRuntimeState(tmuxSession, {
        state: 'idle',
        lastActivity: new Date().toISOString(),
        currentIssue: undefined,
      });
    }

    return {
      success: wakeResult.success,
      queued: false,
      message: wakeResult.message,
      error: wakeResult.error,
    };
  } catch (error: unknown) {
    // Exception - revert state to idle and clear currentIssue
    saveAgentRuntimeState(tmuxSession, {
      state: 'idle',
      lastActivity: new Date().toISOString(),
      currentIssue: undefined,
    });

    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      queued: false,
      message: `Failed to wake specialist ${name}: ${msg}`,
      error: msg,
    };
  }
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
  fromSpecialist: SpecialistType;
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
  bySpecialist: Record<SpecialistType, number>;
  byType: Record<string, number>;
  total: number;
} {
  const stats = {
    bySpecialist: {
      'merge-agent': 0,
      'review-agent': 0,
      'test-agent': 0,
    } as Record<SpecialistType, number>,
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
