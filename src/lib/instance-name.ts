/**
 * The per-home Overdeck instance name.
 *
 * Every terminal backend namespaces its server by it: tmux uses it as the
 * socket name (`tmux -L <instance>`), Herdr as the session name (and therefore
 * `~/.config/herdr/sessions/<instance>/herdr.sock`). `overdeck` belongs to the
 * default `~/.overdeck` home; any other home gets `overdeck-<sha1[0..8]>`.
 *
 * PAN-3673 established the rule for tmux: a derived per-home socket must never
 * take over the default one. fix10 extends it to Herdr, after a test process
 * serving a /tmp home selected the live `overdeck` session and spawned real
 * agents into it.
 *
 * Deliberately dependency-free (no config, no subprocess, no tmux import) so
 * both backends and the selector can read it without pulling each other in.
 */
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { getOverdeckHome } from './paths.js';

/** The instance name the default `~/.overdeck` home owns. */
export const DEFAULT_INSTANCE_NAME = 'overdeck';

export function managedInstanceName(home: string = getOverdeckHome()): string {
  const resolved = resolve(home);
  if (resolved === resolve(join(homedir(), '.overdeck'))) return DEFAULT_INSTANCE_NAME;
  const hash = createHash('sha1').update(resolved).digest('hex').slice(0, 8);
  return `${DEFAULT_INSTANCE_NAME}-${hash}`;
}
