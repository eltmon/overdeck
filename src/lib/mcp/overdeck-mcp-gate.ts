/**
 * PAN-4927 D-13: the one rule for whether a launch gets the `overdeck` MCP server.
 * Leaf module (imports only harness behavior and config) so the context renderers
 * and launcher-field builders can use it (PAN-4935).
 */
import type { RuntimeName } from '../runtimes/types.js';
import { getHarnessBehavior } from '../runtimes/behavior.js';
import { loadConfigNoMigration } from '../config-yaml.js';

/** D-1: the harness declares `capabilities.overdeckMcp`. */
export function harnessGetsOverdeckMcp(harness: RuntimeName): boolean {
  return getHarnessBehavior(harness).capabilities.overdeckMcp;
}

/** FR-5: capability, not a Docker workspace, and config `mcp.agents`. */
export async function overdeckMcpEnabledFor(harness: RuntimeName, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!harnessGetsOverdeckMcp(harness)) return false;
  if (env.OVERDECK_DOCKER_WORKSPACE === '1' || env.PAN_DOCKER === '1') return false;
  return (await loadConfigNoMigration()).config.mcp.agents;
}
