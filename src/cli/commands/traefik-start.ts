import chalk from 'chalk';
import { exec } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { migrateTraefikCompose } from '../../lib/traefik.js';

const execAsync = promisify(exec);

export type TraefikStartResult = 'started' | 'already-running' | 'failed';

export interface TraefikStartDeps {
  migrate?: (composePath: string) => boolean;
  exec?: (command: string, cwd: string) => Promise<{ stdout: string }>;
  log?: (line: string) => void;
}

/**
 * Start the Traefik container for `pan up` and `pan dev` (PAN-4672). The compose
 * migration runs in its own try/catch, as in platform-lifecycle's startTraefikBody:
 * a throw is logged and never skips `docker compose up -d`. A thrown migration
 * counts as "file unchanged", so `skipWhenRunning` leaves a running container alone;
 * only a successful `docker ps` that finds it skips the start. Never rejects.
 */
export async function startTraefikContainer(
  traefikDir: string,
  options: { skipWhenRunning: boolean },
  deps: TraefikStartDeps = {},
): Promise<TraefikStartResult> {
  const migrate = deps.migrate ?? migrateTraefikCompose;
  const run = deps.exec ?? ((command: string, cwd: string) => execAsync(command, { cwd }));
  const log = deps.log ?? ((line: string) => console.log(line));
  let migrated = false;
  try {
    migrated = migrate(join(traefikDir, 'docker-compose.yml'));
  } catch (error) {
    log(chalk.yellow(`⚠ Traefik compose migration failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  if (options.skipWhenRunning && !migrated) {
    try {
      const { stdout } = await run('docker ps --filter "name=overdeck-traefik" --format "{{.Names}}" 2>/dev/null', traefikDir);
      if (stdout.trim().includes('overdeck-traefik')) return 'already-running';
    } catch {
      // A failed check proves nothing about the container; attempt the start below.
    }
  }
  try {
    await run('docker compose up -d', traefikDir);
    return 'started';
  } catch {
    return 'failed';
  }
}
