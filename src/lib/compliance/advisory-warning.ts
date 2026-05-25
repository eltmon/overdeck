import { randomUUID } from 'crypto';
import { readFile, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Effect } from 'effect';
import type { MemoryIdentity, MemoryObservation } from '@panctl/contracts';
import { COMPLIANCE_MODES, loadConfigNoMigration, type ComplianceMode } from '../config-yaml.js';
import { ensureParentDir, resolveIssueMemoryRoot } from '../memory/paths.js';
import { readRecentObservations } from '../memory/rollup.js';

export const COMPLIANCE_ADVISORY_WARNING = "Last turn included a memory-first trigger but the search wasn't called. Try pan memory search first next time.";

interface ComplianceWarningMarkers {
  warnedObservationIds: string[];
}

export interface ResolveComplianceAdvisoryWarningInput {
  identity: MemoryIdentity;
  loadComplianceMode?: () => Promise<ComplianceMode>;
  readObservations?: (projectId: string, issueId: string, limit: number) => Promise<MemoryObservation[]>;
  readMarkers?: (projectId: string, issueId: string) => Promise<ComplianceWarningMarkers>;
  writeMarkers?: (projectId: string, issueId: string, markers: ComplianceWarningMarkers) => Promise<void>;
}

export async function resolveComplianceAdvisoryWarning(input: ResolveComplianceAdvisoryWarningInput): Promise<string | null> {
  const mode = await (input.loadComplianceMode ?? loadComplianceMode)();
  if (mode === 'off') return null;

  const observations = await (input.readObservations ?? readRecentObservations)(input.identity.projectId, input.identity.issueId, 100);
  const markers = await (input.readMarkers ?? readComplianceWarningMarkers)(input.identity.projectId, input.identity.issueId);
  const warned = new Set(markers.warnedObservationIds);
  const miss = [...observations].reverse().find((observation) => isCurrentSessionMiss(observation, input.identity) && !warned.has(observation.id));
  if (!miss) return null;

  warned.add(miss.id);
  await (input.writeMarkers ?? writeComplianceWarningMarkers)(input.identity.projectId, input.identity.issueId, {
    warnedObservationIds: [...warned],
  });
  return COMPLIANCE_ADVISORY_WARNING;
}

export async function loadComplianceMode(): Promise<ComplianceMode> {
  const { config } = await Effect.runPromise(loadConfigNoMigration());
  return COMPLIANCE_MODES.includes(config.compliance.mode) ? config.compliance.mode : 'advisory';
}

export async function readComplianceWarningMarkers(projectId: string, issueId: string): Promise<ComplianceWarningMarkers> {
  try {
    const parsed = JSON.parse(await readFile(resolveComplianceWarningMarkersFile(projectId, issueId), 'utf8')) as Partial<ComplianceWarningMarkers>;
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

export async function writeComplianceWarningMarkers(projectId: string, issueId: string, markers: ComplianceWarningMarkers): Promise<void> {
  const path = resolveComplianceWarningMarkersFile(projectId, issueId);
  await ensureParentDir(path);
  const tempPath = join(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify({ warnedObservationIds: [...new Set(markers.warnedObservationIds)] }, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

export function resolveComplianceWarningMarkersFile(projectId: string, issueId: string): string {
  return join(resolveIssueMemoryRoot(projectId, issueId), 'compliance', 'warned-misses.json');
}

function isCurrentSessionMiss(observation: MemoryObservation, identity: MemoryIdentity): boolean {
  return observation.sessionId === identity.sessionId
    && observation.actionStatus === 'compliance.miss'
    && observation.tags.includes('compliance')
    && observation.tags.includes('miss');
}
