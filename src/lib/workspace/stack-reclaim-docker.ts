/**
 * PAN-5623: the Docker reads and writes behind the memory reclaim of a parked
 * issue's workspace stack.
 *
 * A container belongs to an issue only through its exact
 * `com.docker.compose.project` label (D2), so the listing reads labels, never
 * name patterns. Every call uses promisified `execFile` with an argument array
 * (never a shell string, never `execSync`), resolves `docker` through
 * `resolveHostTool`, and refuses a container name outside
 * `CONTAINER_NAME_RE` without spawning anything: a journaled name is a
 * workspace file and must not inject arguments (NFR-6).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseMemUsage } from '../docker-stats.js';
import { noteHostToolSpawnFailed, resolveHostTool } from '../host-tools.js';

const execFileAsync = promisify(execFile);

/** The only compose services a reclaim may stop. `dev`, databases and caches are never reclaimable. */
export const RECLAIMABLE_STACK_SERVICES: ReadonlySet<string> = new Set(['api', 'fe', 'frontend', 'server']);

/** A container name Overdeck will pass to `docker`. */
export const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export interface ComposeContainer {
  id: string;
  name: string;
  state: string;
  composeProject: string;
  composeService: string;
}

export const COMPOSE_PS_FORMAT =
  '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}';

const LIST_TIMEOUT_MS = 10_000;
const STATS_TIMEOUT_MS = 15_000;
const STOP_START_TIMEOUT_MS = 60_000;

type DockerResult = { ok: true } | { ok: false; error: string };

/** Parses `docker ps --format COMPOSE_PS_FORMAT` output; drops short rows and rows without a compose project. */
export function parseComposePs(stdout: string): ComposeContainer[] {
  const containers: ComposeContainer[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.split('\t');
    if (fields.length < 5) continue;
    const [id, name, state, composeProject, composeService] = fields.map((field) => field.trim());
    if (!id || !name || !composeProject) continue;
    containers.push({ id, name, state, composeProject, composeService });
  }
  return containers;
}

/** Parses `docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'` output into name → bytes in use. */
export function parseStatsMemory(stdout: string): Map<string, number> {
  const memory = new Map<string, number>();
  for (const line of stdout.split('\n')) {
    const [name, usage] = line.split('\t');
    if (!name?.trim() || usage === undefined) continue;
    memory.set(name.trim(), parseMemUsage(usage).usage);
  }
  return memory;
}

async function runDocker(args: readonly string[], timeout: number): Promise<{ ok: true; stdout: string } | { ok: false; error: string }> {
  const docker = resolveHostTool('docker');
  if (docker === null) return { ok: false, error: 'docker not found' };
  try {
    const { stdout } = await execFileAsync(docker, [...args], { timeout, encoding: 'utf8' });
    return { ok: true, stdout };
  } catch (error) {
    noteHostToolSpawnFailed('docker', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Every compose-labelled container (`all` adds stopped ones); `null` when docker is missing or the listing failed. */
export async function listComposeContainers(options: { all: boolean }): Promise<ComposeContainer[] | null> {
  const args = ['ps', ...(options.all ? ['-a'] : []), '--format', COMPOSE_PS_FORMAT];
  const result = await runDocker(args, LIST_TIMEOUT_MS);
  return result.ok ? parseComposePs(result.stdout) : null;
}

/** Memory in use per valid container name; an empty input spawns nothing; `null` when the stats read failed. */
export async function readContainerMemoryBytes(names: readonly string[]): Promise<Map<string, number> | null> {
  const valid = names.filter((name) => CONTAINER_NAME_RE.test(name));
  if (valid.length === 0) return new Map();
  const result = await runDocker(['stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}', ...valid], STATS_TIMEOUT_MS);
  return result.ok ? parseStatsMemory(result.stdout) : null;
}

/** `docker stop <idOrName>`. */
export async function stopContainer(idOrName: string): Promise<DockerResult> {
  if (!CONTAINER_NAME_RE.test(idOrName)) return { ok: false, error: 'invalid container name' };
  const result = await runDocker(['stop', idOrName], STOP_START_TIMEOUT_MS);
  return result.ok ? { ok: true } : result;
}

/** `docker start <name>`. */
export async function startContainer(name: string): Promise<DockerResult> {
  if (!CONTAINER_NAME_RE.test(name)) return { ok: false, error: 'invalid container name' };
  const result = await runDocker(['start', name], STOP_START_TIMEOUT_MS);
  return result.ok ? { ok: true } : result;
}
