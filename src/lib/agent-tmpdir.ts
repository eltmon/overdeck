/**
 * Agent scratch root (PAN-4998). Claude Code keeps its session scratchpad under
 * `<CLAUDE_CODE_TMPDIR>/claude-<uid>/<encoded-cwd>/<session-uuid>/`; the default is
 * /tmp, which Ubuntu empties at every boot. Managed launches point it here instead,
 * and the Deacon's agent-tmp sweep removes idle session directories.
 */
import { join } from 'node:path';

import { getOverdeckHome } from './paths.js';
import { shellQuote } from './shell-quote.js';

export const AGENT_TMP_RETENTION_DAYS = 14;

/** `<OVERDECK_HOME>/tmp` — read at call time so OVERDECK_HOME overrides apply. */
export function getAgentTmpDir(): string {
  return join(getOverdeckHome(), 'tmp');
}

/**
 * The launcher line: create the root private (0700) and export it. A failed
 * mkdir/chmod leaves the variable unset, so Claude Code falls back to /tmp.
 * Contains no `$`, so `escapeForBase64` leaves it unchanged.
 */
export function agentTmpdirLauncherLine(dir: string = getAgentTmpDir()): string {
  const q = shellQuote(dir);
  return `mkdir -p ${q} && chmod 700 ${q} && export CLAUDE_CODE_TMPDIR=${q}`;
}
