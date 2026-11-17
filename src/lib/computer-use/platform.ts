/**
 * Computer-use platform detection and provider lookup (PAN-5461).
 *
 * `detectPlatform` maps the host to a platform id: 'linux', 'wsl' (Linux under
 * WSL2: WSL_DISTRO_NAME set, or the kernel osrelease names Microsoft),
 * 'darwin', or 'unsupported'. The seam types live in platform-types.ts and are
 * re-exported here for callers outside the providers (D-10).
 */
import { readFileSync } from 'node:fs';
import type { ComputerUsePlatformId, ComputerUseProvider } from './platform-types.js';
import { linuxProvider } from './providers/linux.js';

export type {
  ComputerUsePlatformId,
  ReadinessStatus,
  ReadinessCheck,
  ProviderSession,
  SetupStepId,
  SetupStep,
  SetupStepResult,
  ReadinessReport,
  KeyPlatform,
  ComputerUseProvider,
} from './platform-types.js';

export interface DetectPlatformDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  readOsRelease?: () => string | null;
}

function readKernelOsRelease(): string | null {
  try {
    return readFileSync('/proc/sys/kernel/osrelease', 'utf8');
  } catch {
    return null;
  }
}

export function detectPlatform(deps: DetectPlatformDeps = {}): ComputerUsePlatformId | 'unsupported' {
  const platform = deps.platform ?? process.platform;
  if (platform === 'darwin') return 'darwin';
  if (platform !== 'linux') return 'unsupported';

  const env = deps.env ?? process.env;
  const distro = env.WSL_DISTRO_NAME;
  if (typeof distro === 'string' && distro.length > 0) return 'wsl';

  const osRelease = (deps.readOsRelease ?? readKernelOsRelease)();
  if (osRelease !== null && /microsoft/i.test(osRelease)) return 'wsl';
  return 'linux';
}

/** The provider for a platform id, or null where computer use is not supported yet. */
export function providerFor(id: ComputerUsePlatformId | 'unsupported'): ComputerUseProvider | null {
  switch (id) {
    case 'linux':
      return linuxProvider;
    default:
      return null; // PAN-5462 adds 'wsl', PAN-5463 adds 'darwin'
  }
}
