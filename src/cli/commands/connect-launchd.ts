/**
 * `pan connect` on macOS (PAN-4656, FR-6, D-10): write and load the
 * `ai.overdeck.supervisor` launch agent. The agent starts when the user logs
 * in; macOS has no lingering for agents, so a Mac that must come back after a
 * reboot with nobody logged in needs automatic login, and the outcome says so.
 */
import { join } from 'node:path';

import { LOCAL_NETWORK_SETTINGS } from '../../lib/anywhere/local-network.js';
import {
  installSupervisorAgent,
  SUPERVISOR_AGENT_LABEL,
  type RenderSupervisorPlistOptions,
} from '../../lib/launchd.js';
import { getSupervisorPort, resolveSupervisorBundle, resolveSupervisorPrimaryRepoRoot } from '../../lib/supervisor.js';
import { withoutGitGuard } from '../../lib/systemd-user-session.js';
import type { ServiceContext, ServiceOutcome } from './connect-service.js';

/** launchd's default PATH, used only when the operator's shell has none. */
const FALLBACK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

export interface MacServiceDeps {
  execPath: string;
  supervisorBundle: () => string;
  workingDirectory: () => string;
  supervisorPort: () => number;
  installSupervisorAgent: (options: RenderSupervisorPlistOptions) => Promise<unknown>;
}

const defaultDeps: MacServiceDeps = {
  execPath: process.execPath,
  supervisorBundle: resolveSupervisorBundle,
  workingDirectory: resolveSupervisorPrimaryRepoRoot,
  supervisorPort: getSupervisorPort,
  installSupervisorAgent: (options) => installSupervisorAgent(options),
};

export async function installMacService(ctx: ServiceContext, deps: Partial<MacServiceDeps> = {}): Promise<ServiceOutcome> {
  const d = { ...defaultDeps, ...deps };
  await d.installSupervisorAgent({
    nodePath: d.execPath,
    supervisorBundle: d.supervisorBundle(),
    workingDirectory: d.workingDirectory(),
    supervisorPort: d.supervisorPort(),
    overdeckHome: ctx.overdeckHome,
    path: withoutGitGuard(ctx.env.PATH ?? '') || FALLBACK_PATH,
    logPath: join(ctx.overdeckHome, 'logs', 'supervisor.log'),
  });
  return {
    manager: 'launchd',
    name: SUPERVISOR_AGENT_LABEL,
    enabled: true,
    line: `launchd agent ${SUPERVISOR_AGENT_LABEL} (~/Library/LaunchAgents/${SUPERVISOR_AGENT_LABEL}.plist). `
      + `It starts when ${ctx.user} logs in; for a Mac that must come back after a reboot with nobody logged in, `
      + 'turn on automatic login in System Settings → Users & Groups.',
    linger: 'not-applicable',
    note: `macOS blocks the server's connections to other machines on this network until you allow them: `
      + `on this Mac, open ${LOCAL_NETWORK_SETTINGS} and turn on node (${d.execPath}). `
      + 'node appears in that list after the server first tries to reach another machine, so check it once this Mac is linked.',
  };
}
