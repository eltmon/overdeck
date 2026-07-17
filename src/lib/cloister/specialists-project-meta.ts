/**
 * Cloister Specialist Project Metadata
 *
 * Manages per-project specialist run metadata and configuration.
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  SPECIALISTS_DIR,
  getAllSpecialists,
  getSpecialistMetadata,
  getTmuxSessionName,
  isProjectSpecialistActivelyRunning,
  loadRegistry,
  parseSpecialistRegistryKey,
  saveRegistry,
  updateSpecialistMetadata,
  type LegacySpecialistDefinition,
  type ProjectSpecialistMetadata,
  type SpecialistAgentName,
} from './specialists-registry.js';
import { isRunning } from './specialists-status.js';

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
  const { getAgentRuntimeStateSync } = await import('../agents.js');

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

      const runtimeState = getAgentRuntimeStateSync(tmuxSession);
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
