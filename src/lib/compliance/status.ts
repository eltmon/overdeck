import { join } from 'path';
import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import type { MemoryObservation } from '@panctl/contracts';
import { getPanopticonHome } from '../paths.js';
import { searchMemory, type MemorySearchResult } from '../memory/cli.js';

export const COMPLIANCE_MODES = ['off', 'advisory', 'enforcing'] as const;
export type ComplianceMode = typeof COMPLIANCE_MODES[number];

export interface ComplianceStatusOptions {
  project?: string;
  workspace?: string;
  issue?: string;
  session?: string;
  sinceHours?: number;
  now?: Date;
  configPath?: string;
}

export interface ComplianceStatusResult {
  mode: ComplianceMode;
  recentMissCount: number;
  since: string;
  projectId: string;
  workspaceId: string | null;
  issueId: string | null;
  sessionId: string | null;
}

const DEFAULT_PROJECT_ID = 'panopticon-cli';
const DEFAULT_SINCE_HOURS = 24;

export async function getComplianceStatus(options: ComplianceStatusOptions = {}): Promise<ComplianceStatusResult> {
  const projectId = options.project ?? DEFAULT_PROJECT_ID;
  const sinceHours = Number.isFinite(options.sinceHours) && (options.sinceHours ?? 0) > 0
    ? options.sinceHours as number
    : DEFAULT_SINCE_HOURS;
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - sinceHours * 60 * 60 * 1000).toISOString();
  const [mode, misses] = await Promise.all([
    readComplianceMode(options.configPath),
    readComplianceMisses({ ...options, project: projectId, since }),
  ]);

  return {
    mode,
    recentMissCount: misses.length,
    since,
    projectId,
    workspaceId: options.workspace ?? null,
    issueId: options.issue ?? null,
    sessionId: options.session ?? null,
  };
}

async function readComplianceMisses(options: ComplianceStatusOptions & { project: string; since: string }): Promise<MemoryObservation[]> {
  const results = await searchMemory('compliance.miss', {
    project: options.project,
    issue: options.issue,
    workspace: options.workspace,
    limit: 10_000,
  });
  return results
    .map((result: MemorySearchResult) => result.observation)
    .filter(isComplianceMiss)
    .filter((observation) => observation.timestamp >= options.since)
    .filter((observation) => !options.session || observation.sessionId === options.session);
}

async function readComplianceMode(configPath = join(getPanopticonHome(), 'config.yaml')): Promise<ComplianceMode> {
  let parsed: unknown;
  try {
    parsed = yaml.load(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (isEnoent(error)) return 'advisory';
    throw error;
  }

  const config = isRecord(parsed) ? parsed : {};
  const compliance = isRecord(config.compliance) ? config.compliance : {};
  return parseComplianceMode(compliance.mode);
}

function parseComplianceMode(value: unknown): ComplianceMode {
  return typeof value === 'string' && isComplianceMode(value) ? value : 'advisory';
}

function isComplianceMode(value: string): value is ComplianceMode {
  return (COMPLIANCE_MODES as readonly string[]).includes(value);
}

function isComplianceMiss(observation: MemoryObservation): boolean {
  return observation.tags.includes('compliance.miss') ||
    observation.actionStatus === 'compliance.miss' ||
    observation.summary.includes('compliance.miss') ||
    observation.narrative.includes('compliance.miss');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
