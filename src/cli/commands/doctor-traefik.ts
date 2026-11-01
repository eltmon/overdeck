/**
 * Traefik port-binding doctor check (PAN-4299).
 *
 * The shared overdeck-traefik container fronts the dashboard. When it
 * publishes 80/443/8080 on every interface, LAN clients can reach the
 * dashboard and the Traefik API. The template and `migrateTraefikCompose`
 * bind loopback unless `[traefik] bind = "all"`; this check reads the live
 * container so a stale one (created before the migration) is reported.
 */
import { exec } from 'child_process';
import { promisify } from 'util';

import { loadConfigSync } from '../../lib/config.js';

const execAsync = promisify(exec);

// Structurally identical to doctor.ts's CheckResult; re-declared (like
// doctor-inotify.ts) because importing it would create a module cycle.
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

const CHECK_NAME = 'Traefik port binding';

/**
 * Classify `docker ps --format '{{.Ports}}'` output, e.g.
 * `0.0.0.0:80->80/tcp, [::]:80->80/tcp`. A segment is exposed when its host
 * part starts with `0.0.0.0:`, `[::]:` or `:::`. Pure.
 */
export function classifyTraefikPorts(portsLine: string, bind: unknown): CheckResult {
  if (bind === 'all') {
    return { name: CHECK_NAME, status: 'warn', message: 'traefik.bind = "all": Traefik is reachable from other machines' };
  }
  const exposed = portsLine
    .split(',')
    .map((segment) => segment.trim())
    .some((segment) => segment.startsWith('0.0.0.0:') || segment.startsWith('[::]:') || segment.startsWith(':::'));
  if (exposed) {
    return {
      name: CHECK_NAME,
      status: 'error',
      message: 'overdeck-traefik publishes on all interfaces; LAN clients can reach the dashboard',
      fix: 'Run: pan restart --traefik',
    };
  }
  return { name: CHECK_NAME, status: 'ok', message: 'Published on 127.0.0.1 only' };
}

/** Report the live overdeck-traefik binding. Empty when Traefik is disabled or not running. */
export async function checkTraefikPortBinding(): Promise<CheckResult[]> {
  const traefik = loadConfigSync().traefik;
  if (traefik?.enabled !== true) return [];
  let stdout: string;
  try {
    ({ stdout } = await execAsync(`docker ps --filter name=overdeck-traefik --format '{{.Ports}}'`));
  } catch {
    return [];
  }
  const portsLine = stdout.trim();
  if (!portsLine) return [];
  return [classifyTraefikPorts(portsLine, traefik.bind)];
}
