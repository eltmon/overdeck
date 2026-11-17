/**
 * The Linux computer-use provider (PAN-5461, PRD WI-1c).
 *
 * Wraps the Linux-specific modules behind the ComputerUseProvider seam:
 * desktop-env.ts resolves the session, readiness-linux.ts reports readiness,
 * setup-linux.ts runs setup steps, and helper.ts runs the helper. Types come
 * from ../platform-types.js, never ../platform.js, because platform.ts imports
 * this file (D-10).
 */
import { resolveDesktopEnv as resolveDesktopEnvReal, type ResolveDesktopEnvDeps } from '../desktop-env.js';
import { runHelper as runHelperReal } from '../helper.js';
import type { ComputerUseProvider, ProviderSession, SetupStepResult } from '../platform-types.js';
import {
  linuxReadiness,
  planLinuxInstall,
  probeLinux,
  type LinuxPackageManagerId,
  type LinuxReadinessDeps,
} from '../readiness-linux.js';
import { enableGnomeAccessibility, installPackages, manualInstallResult, type LinuxSetupDeps } from '../setup-linux.js';

type AutomaticManager = 'apt-get' | 'dnf' | 'pacman';

function isAutomaticManager(manager: LinuxPackageManagerId | null): manager is AutomaticManager {
  return manager === 'apt-get' || manager === 'dnf' || manager === 'pacman';
}

export function createLinuxProvider(deps: LinuxReadinessDeps & LinuxSetupDeps = {}): ComputerUseProvider {
  const resolveDesktopEnv = deps.resolveDesktopEnv ?? ((envDeps?: ResolveDesktopEnvDeps) => resolveDesktopEnvReal(envDeps));
  const runHelper = deps.runHelper ?? ((operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => runHelperReal(operation, env));

  const resolveSession: ComputerUseProvider['resolveSession'] = async () => {
    const result = await resolveDesktopEnv();
    if (!result.ok) return { ok: false, code: result.code, message: result.message };
    const { env } = result;
    const session: ProviderSession = {
      label: `${env.XDG_SESSION_TYPE || 'unknown'} · display ${env.DISPLAY ?? env.WAYLAND_DISPLAY ?? ''}`,
      env,
    };
    return { ok: true, session };
  };

  async function installMissingPackages(session: ProviderSession): Promise<SetupStepResult> {
    const probe = await probeLinux({ detectPackageManager: true }, deps);
    const plan = planLinuxInstall(probe);
    if (!plan) return { status: 'skipped' };
    if (plan.automatic && isAutomaticManager(plan.packageManager)) {
      return installPackages(plan.packageManager, plan.packages, session, deps);
    }
    const manual = plan.packageManager === 'zypper' || plan.packageManager === 'apk' ? plan.packageManager : null;
    return manualInstallResult(manual, plan.packages);
  }

  return {
    id: 'linux',
    blockedKeyPlatform: 'linux',
    resolveSession,
    async readiness({ probeHelper }) {
      const { session, checks, setupSteps } = await linuxReadiness({ helperLock: probeHelper, setupSteps: true }, deps);
      return { session, checks, setupSteps };
    },
    async runSetupStep(id) {
      if (id === 'grant-permissions') return { status: 'skipped' };
      const sessionResult = await resolveSession();
      if (!sessionResult.ok) return { status: 'failed', message: sessionResult.message };
      if (id === 'install-packages') return installMissingPackages(sessionResult.session);
      return enableGnomeAccessibility(sessionResult.session, deps);
    },
    runHelper(operation, session) {
      return runHelper(operation, session.env);
    },
  };
}

export const linuxProvider: ComputerUseProvider = createLinuxProvider();
