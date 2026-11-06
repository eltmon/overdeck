import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TELEMETRY_INSTALL_KINDS, type TelemetryInstallKind } from '@overdeck/contracts';
import { getOverdeckHome, isDevMode } from '../paths.js';

export const INSTALL_KIND_FILENAME = 'install-kind';

const CONTAINER_MARKER_PATHS = ['/.dockerenv', '/run/.containerenv'] as const;

export interface InstallKindProbe {
  overdeckHome: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
  isDevCheckout: boolean;
}

function defaultProbe(): InstallKindProbe {
  return {
    overdeckHome: getOverdeckHome(),
    exists: existsSync,
    readFile: (path: string) => readFileSync(path, 'utf8'),
    isDevCheckout: isDevMode(),
  };
}

function isTelemetryInstallKind(value: string): value is TelemetryInstallKind {
  return (TELEMETRY_INSTALL_KINDS as readonly string[]).includes(value);
}

/**
 * PAN-5084: what kind of install reported an event. Marker file wins over
 * every other signal so an operator (or a provisioning script) can always
 * force a value. Each probe call is wrapped in try/catch — a broken or
 * permission-denied probe degrades to the next signal, never a throw.
 */
export function resolveInstallKind(probe: InstallKindProbe = defaultProbe()): TelemetryInstallKind {
  try {
    const markerPath = join(probe.overdeckHome, INSTALL_KIND_FILENAME);
    if (probe.exists(markerPath)) {
      const marker = probe.readFile(markerPath).trim();
      if (isTelemetryInstallKind(marker)) return marker;
    }
  } catch {
    // Fall through to the remaining signals.
  }

  if (probe.isDevCheckout) return 'dev_checkout';

  try {
    for (const markerPath of CONTAINER_MARKER_PATHS) {
      if (probe.exists(markerPath)) return 'container';
    }
  } catch {
    // Fall through to 'user'.
  }

  return 'user';
}

let cachedInstallKind: TelemetryInstallKind | undefined;

/** Per-process cached install kind; resolved once per boot. */
export function getInstallKind(): TelemetryInstallKind {
  if (cachedInstallKind === undefined) cachedInstallKind = resolveInstallKind();
  return cachedInstallKind;
}
