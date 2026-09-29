// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-ollama.ts and doctor-tier-fitness.ts) because importing it would
// create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { resolveMemoryBase } from '../../lib/memory/paths.js';
import type { MemoryHealthSnapshot } from '../../lib/memory/health.js';

export interface CheckMemoryExtractionOptions {
  memoryBase?: string;
}

interface MemoryExtractionEvent {
  timestamp: string;
  kind: 'success' | 'failure';
  projectId: string;
  workspaceId: string;
  snapshot: MemoryHealthSnapshot;
}

/**
 * Surfaces the newest memory-extraction success or failure across every
 * workspace's health.json (PAN-4370), so a credentials or cost-cap problem
 * shows up in `pan doctor` instead of requiring the operator to know to run
 * `pan memory doctor` or open health.json by hand.
 */
export async function checkMemoryExtraction(options: CheckMemoryExtractionOptions = {}): Promise<CheckResult> {
  const base = options.memoryBase ?? resolveMemoryBase();
  const events = await collectMemoryExtractionEvents(base);

  if (events.length === 0) {
    return { name: 'Memory extraction', status: 'ok', message: 'no memory extraction activity recorded' };
  }

  const newest = events.reduce((latest, event) => (event.timestamp > latest.timestamp ? event : latest));
  const location = `${newest.projectId}/${newest.workspaceId}`;

  if (newest.kind === 'success') {
    return { name: 'Memory extraction', status: 'ok', message: `last success ${newest.timestamp} (${location})` };
  }

  const reason = newest.snapshot.last_failure_reason ?? 'unknown';
  const detail = newest.snapshot.last_failure_detail ?? 'no detail';
  return {
    name: 'Memory extraction',
    status: 'warn',
    message: `failing: ${reason} — ${detail} (${location}, ${newest.timestamp})`,
    fix: fixForReason(reason),
  };
}

function fixForReason(reason: string): string {
  if (reason === 'provider-auth-failed') {
    return 'The memory extraction provider has no working credentials in the dashboard and agent-hook environment. Export ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) for the dashboard service and agent sessions, or set memory.extraction.provider in ~/.overdeck/config.yaml to a provider that can authenticate on this host (a Claude-subscription provider is tracked in PAN-4374).';
  }
  if (reason === 'cost-cap') {
    return "Today's memory extraction spend reached memory.extraction.per_day_cost_cap_usd; raise it or wait for the next day.";
  }
  return 'Run pan memory doctor for per-workspace failure detail.';
}

async function collectMemoryExtractionEvents(base: string): Promise<MemoryExtractionEvent[]> {
  const projectDirs = await readDirNames(base);
  const perProject = await Promise.all(projectDirs.map(async (projectId) => {
    const workspaceDirs = await readDirNames(join(base, projectId));
    const perWorkspace = await Promise.all(workspaceDirs.map((workspaceId) =>
      readMemoryExtractionEvents(base, projectId, workspaceId)));
    return perWorkspace.flat();
  }));
  return perProject.flat();
}

async function readMemoryExtractionEvents(base: string, projectId: string, workspaceId: string): Promise<MemoryExtractionEvent[]> {
  let snapshot: MemoryHealthSnapshot;
  try {
    const raw = await readFile(join(base, projectId, workspaceId, 'health.json'), 'utf8');
    snapshot = JSON.parse(raw) as MemoryHealthSnapshot;
  } catch {
    return [];
  }

  const events: MemoryExtractionEvent[] = [];
  if (snapshot.last_success) events.push({ timestamp: snapshot.last_success, kind: 'success', projectId, workspaceId, snapshot });
  if (snapshot.last_failure) events.push({ timestamp: snapshot.last_failure, kind: 'failure', projectId, workspaceId, snapshot });
  return events;
}

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
