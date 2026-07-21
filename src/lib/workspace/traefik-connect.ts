/**
 * PAN-2428: Traefik must be connected to every workspace stack network, or
 * *.{project}.localhost routes 504 (Gateway Timeout). Stacks come up through
 * more than one door — `rebuildWorkspaceStack`, the MYN workspace `dev`
 * script, manual `docker compose up` — so a connect call at stack-up time is
 * not sufficient. This module provides one idempotent reconciler used both
 * after Overdeck-initiated stack-ups and on the deacon patrol tick.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TRAEFIK_CONTAINER = 'overdeck-traefik';

/** Workspace stack networks look like `myn-feature-min-862_devnet` or `overdeck-feature-pan-123_default`. */
const WORKSPACE_NETWORK_RE = /-feature-[a-z0-9-]+_(devnet|default)$/;

/**
 * Connect the traefik container to every workspace network it is missing.
 * Idempotent: already-connected networks are skipped; connect races are
 * swallowed. Returns one human-readable action string per new connection.
 */
export async function reconcileTraefikNetworks(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { stdout: running } = await execFileAsync(
      'docker', ['ps', '--filter', `name=${TRAEFIK_CONTAINER}`, '--format', '{{.Names}}'],
      { timeout: 10_000 },
    );
    if (!running.split('\n').map(s => s.trim()).includes(TRAEFIK_CONTAINER)) return actions;

    const { stdout: connectedRaw } = await execFileAsync(
      'docker',
      ['inspect', TRAEFIK_CONTAINER, '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}\n{{end}}'],
      { timeout: 10_000 },
    );
    const connected = new Set(connectedRaw.split('\n').map(s => s.trim()).filter(Boolean));

    const { stdout: netsRaw } = await execFileAsync(
      'docker', ['network', 'ls', '--format', '{{.Name}}'],
      { timeout: 10_000 },
    );
    const candidates = netsRaw
      .split('\n')
      .map(s => s.trim())
      .filter(name => WORKSPACE_NETWORK_RE.test(name) && !connected.has(name));

    for (const net of candidates) {
      // Only join networks that have live containers — connecting to the
      // leftover network of a torn-down stack just accumulates endpoints.
      try {
        const { stdout: count } = await execFileAsync(
          'docker', ['network', 'inspect', net, '--format', '{{len .Containers}}'],
          { timeout: 10_000 },
        );
        if (parseInt(count.trim(), 10) === 0) continue;
        await execFileAsync('docker', ['network', 'connect', net, TRAEFIK_CONTAINER], { timeout: 10_000 });
        actions.push(`Connected ${TRAEFIK_CONTAINER} to workspace network ${net} (PAN-2428 route heal)`);
      } catch {
        // Concurrent connect, network vanished mid-loop, or endpoint already
        // exists — all fine on the next pass.
      }
    }
  } catch {
    // Docker unavailable — nothing to reconcile.
  }
  return actions;
}
