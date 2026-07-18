/**
 * Cloister Specialist Registry
 *
 * Manages specialist metadata, registry persistence, and session naming.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { OVERDECK_HOME } from '../paths.js';

const SPECIALISTS_DIR = join(OVERDECK_HOME, 'specialists');
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
 * removes ~/.overdeck/specialists/ on every boot. The previous body of this
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
 * issue — sessions are reused across review rounds via the agent message delivery path.
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

