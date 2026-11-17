/**
 * The Settings → Computer Use status view (PAN-5461, PRD WI-3b).
 *
 * Assembles one ComputerUseStatusView for the host: the platform and whether a
 * provider supports it, the global flag, the provider's readiness rows, the
 * setup steps the Setup button would run (provider steps, then enable-flag,
 * then test-helper), the current desktop lease and where the pan-computer-use
 * skill is installed. Every status describes the host, never the browser's
 * device.
 */
import { access } from 'node:fs/promises';
import { homedir as homedirReal, hostname as hostnameReal } from 'node:os';
import { join } from 'node:path';
import { readLease as readLeaseReal, type LeaseView } from './lease.js';
import { detectPlatform as detectPlatformReal, providerFor as providerForReal } from './platform.js';
import type { ComputerUsePlatformId, ReadinessCheck, SetupStep } from './platform-types.js';
import { unsupportedMessage } from './run.js';
import { readComputerUseSettings } from './settings.js';

export interface ComputerUseStatusView {
  platform: ComputerUsePlatformId | 'unsupported';
  supported: boolean; // providerFor(platform) !== null
  enabled: boolean; // readComputerUseSettings().enabled
  hostname: string; // os.hostname()
  session: { ok: true; label: string } | { ok: false; message: string };
  checks: ReadinessCheck[];
  setupSteps: SetupStep[];
  lease: { holder: string; expiresAt: string } | null;
  skill: { installed: boolean; locations: string[] };
}

export interface StatusDeps {
  detectPlatform?: () => ComputerUsePlatformId | 'unsupported';
  providerFor?: typeof providerForReal;
  readSettings?: () => Promise<{ enabled: boolean }>;
  readLease?: (now: number) => Promise<LeaseView | null>;
  hostname?: () => string;
  homedir?: () => string;
  access?: (path: string) => Promise<void>;
  now?: () => number;
}

const SKILL_HOMES = [
  { dir: ['.claude', 'skills'], label: '~/.claude/skills' },
  { dir: ['.agents', 'skills'], label: '~/.agents/skills' },
] as const;

async function findSkill(home: string, accessFn: (path: string) => Promise<void>): Promise<{ installed: boolean; locations: string[] }> {
  const found = await Promise.all(
    SKILL_HOMES.map(async ({ dir, label }) => {
      try {
        await accessFn(join(home, ...dir, 'pan-computer-use', 'SKILL.md'));
        return label;
      } catch {
        return null;
      }
    }),
  );
  const locations = found.filter((label): label is (typeof SKILL_HOMES)[number]['label'] => label !== null);
  return { installed: locations.length > 0, locations };
}

/** Builds the status view. Settings read errors (YAML syntax) propagate as ComputerUseConfigSyntaxError. */
export async function buildStatus(options: { probeHelper: 'wait' | 'if-free' }, deps: StatusDeps = {}): Promise<ComputerUseStatusView> {
  const platform = (deps.detectPlatform ?? (() => detectPlatformReal()))();
  const provider = (deps.providerFor ?? providerForReal)(platform);
  const now = (deps.now ?? Date.now)();

  const [settings, lease, skill] = await Promise.all([
    (deps.readSettings ?? (() => readComputerUseSettings()))(),
    (deps.readLease ?? ((at: number) => readLeaseReal(at)))(now),
    findSkill((deps.homedir ?? homedirReal)(), deps.access ?? ((path: string) => access(path))),
  ]);
  const base = { platform, enabled: settings.enabled, hostname: (deps.hostname ?? hostnameReal)(), lease, skill };

  if (!provider) {
    return {
      ...base,
      supported: false,
      session: { ok: false, message: unsupportedMessage(platform, process.platform) },
      checks: [],
      setupSteps: [],
    };
  }

  const report = await provider.readiness({ probeHelper: options.probeHelper });
  const setupSteps: SetupStep[] = [];
  if (report.session.ok) {
    setupSteps.push(...report.setupSteps);
    if (!settings.enabled) setupSteps.push({ id: 'enable-flag', label: 'Turn on Computer Use' });
    const helperOk = report.checks.find((check) => check.id === 'helper')?.status === 'ok';
    if (setupSteps.length > 0 || !helperOk) setupSteps.push({ id: 'test-helper', label: 'Test the helper' });
  }

  return { ...base, supported: true, session: report.session, checks: report.checks, setupSteps };
}
