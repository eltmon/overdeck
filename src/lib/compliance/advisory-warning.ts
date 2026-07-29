import { randomUUID } from 'crypto';
import { readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';
import { COMPLIANCE_MODES, loadConfigNoMigration, type ComplianceMode } from '../config-yaml.js';
import { ensureParentDir, resolveWorkspaceMemoryRoot } from '../memory/paths.js';
import { readRecentObservations } from '../memory/rollup.js';

export const COMPLIANCE_ADVISORY_WARNING = "Last turn included a memory-first trigger but the search wasn't called. Try pan memory search first next time.";

interface ComplianceWarningMarkers {
  warnedObservationIds: string[];
}

export interface ResolveComplianceAdvisoryWarningInput {
  identity: MemoryIdentity;
  loadComplianceMode?: () => Promise<ComplianceMode>;
  readObservations?: (projectId: string, workspaceId: string, limit: number) => Promise<MemoryObservation[]>;
  readMarkers?: (projectId: string, workspaceId: string) => Promise<ComplianceWarningMarkers>;
  writeMarkers?: (projectId: string, workspaceId: string, markers: ComplianceWarningMarkers) => Promise<void>;
}

export async function resolveComplianceAdvisoryWarning(input: ResolveComplianceAdvisoryWarningInput): Promise<string | null> {
  const { projectId, workspaceId } = input.identity;

  const mode = await (input.loadComplianceMode ?? loadComplianceMode)();
  if (mode === 'off') return null;

  const observations = await (input.readObservations ?? readRecentObservations)(projectId, workspaceId, 100);
  const markers = await (input.readMarkers ?? readComplianceWarningMarkers)(projectId, workspaceId);
  const warned = new Set(markers.warnedObservationIds);
  const miss = [...observations].reverse().find((observation) => isCurrentSessionMiss(observation, input.identity) && !warned.has(observation.id));
  if (!miss) return null;

  warned.add(miss.id);
  await (input.writeMarkers ?? writeComplianceWarningMarkers)(projectId, workspaceId, {
    warnedObservationIds: [...warned],
  });
  return COMPLIANCE_ADVISORY_WARNING;
}

export async function loadComplianceMode(): Promise<ComplianceMode> {
  const { config } = await Effect.runPromise(loadConfigNoMigration());
  return COMPLIANCE_MODES.includes(config.compliance.mode) ? config.compliance.mode : 'advisory';
}

export async function readComplianceWarningMarkers(projectId: string, workspaceId: string): Promise<ComplianceWarningMarkers> {
  try {
    const parsed = JSON.parse(await readFile(resolveComplianceWarningMarkersFile(projectId, workspaceId), 'utf8')) as Partial<ComplianceWarningMarkers>;
    return {
      warnedObservationIds: Array.isArray(parsed.warnedObservationIds)
        ? parsed.warnedObservationIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [],
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { warnedObservationIds: [] };
    }
    throw error;
  }
}

export async function writeComplianceWarningMarkers(projectId: string, workspaceId: string, markers: ComplianceWarningMarkers): Promise<void> {
  const path = resolveComplianceWarningMarkersFile(projectId, workspaceId);
  await ensureParentDir(path);
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify({ warnedObservationIds: [...new Set(markers.warnedObservationIds)] }, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export function resolveComplianceWarningMarkersFile(projectId: string, workspaceId: string): string {
  return join(resolveWorkspaceMemoryRoot(projectId, workspaceId), 'compliance', 'warned-misses.json');
}

function isCurrentSessionMiss(observation: MemoryObservation, identity: MemoryIdentity): boolean {
  return observation.sessionId === identity.sessionId
    && observation.actionStatus === 'compliance.miss'
    && observation.tags.includes('compliance')
    && observation.tags.includes('miss');
}
