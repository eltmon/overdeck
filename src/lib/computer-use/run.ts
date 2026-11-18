/**
 * The guarded preamble every `pan computer` command goes through (PAN-5452,
 * PRD 3h). This file covers preamble steps 1-4 and 8, plus the two commands
 * that skip most of it: `capabilities` (FR-13, never refuses) and `release`.
 * Steps 5-7 (key checks, stdin, element resolution) live in commands.ts,
 * which builds the operation and calls `runComputerOperation`.
 */
import { loadConfigSync } from '../config-yaml.js';
import { ComputerUseError } from './errors.js';
import type { RawSnapshot } from './format.js';
import type { HelperResponse } from './helper.js';
import {
  claimLease as claimLeaseReal,
  holderKey as holderKeyReal,
  releaseLease as releaseLeaseReal,
  withDesktopLock as withDesktopLockReal,
} from './lease.js';
import { detectPlatform as detectPlatformReal, providerFor as providerForReal } from './platform.js';
import type { ComputerUsePlatformId } from './platform-types.js';
import { type SavedScreenshot, saveScreenshot as saveScreenshotReal, saveSnapshot as saveSnapshotReal } from './snapshot-store.js';
import { windowsVersion as windowsVersionReal } from './wsl-bridge.js';

export type OperationKind = 'read' | 'input';

export interface RunComputerOperationInput {
  kind: OperationKind;
  operation: Record<string, unknown>;
}

export interface RunComputerOperationResult {
  response: HelperResponse;
  screenshot: SavedScreenshot | null;
}

export interface LoadedConfig {
  computerUse: { enabled: boolean };
}

export interface RunDeps {
  platform?: NodeJS.Platform;
  loadConfig?: () => LoadedConfig;
  detectPlatform?: () => ComputerUsePlatformId | 'unsupported';
  providerFor?: typeof providerForReal;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  claimLease?: (now: number) => Promise<void>;
  releaseLease?: (options: { force?: boolean }) => Promise<void>;
  saveSnapshot?: typeof saveSnapshotReal;
  saveScreenshot?: typeof saveScreenshotReal;
  holderKey?: () => string;
  now?: () => number;
  /** The Windows build for the wsl provider's capabilities label (PAN-5462 FR-1). */
  windowsVersion?: () => Promise<{ powershell: string; build: string }>;
}

const DISABLED_MESSAGE =
  'Computer use is off. Turn it on in the dashboard under Settings → Computer Use, or set computer_use: { enabled: true } in ~/.overdeck/config.yaml.';

/** The `unsupported_platform` message for a host with no provider (FR-2). */
export function unsupportedMessage(id: ComputerUsePlatformId | 'unsupported', platform: NodeJS.Platform): string {
  return `Computer use isn't supported on this host (${id === 'unsupported' ? platform : id}) yet.`;
}

function resolvedDeps(deps: RunDeps) {
  return {
    platform: deps.platform ?? process.platform,
    loadConfig: deps.loadConfig ?? (() => loadConfigSync().config),
    detectPlatform: deps.detectPlatform ?? (() => detectPlatformReal({ platform: deps.platform ?? process.platform })),
    providerFor: deps.providerFor ?? providerForReal,
    withDesktopLock: deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn)),
    claimLease: deps.claimLease ?? ((now: number) => claimLeaseReal(now)),
    releaseLease: deps.releaseLease ?? ((options: { force?: boolean }) => releaseLeaseReal(options)),
    saveSnapshot: deps.saveSnapshot ?? saveSnapshotReal,
    saveScreenshot: deps.saveScreenshot ?? saveScreenshotReal,
    holderKey: deps.holderKey ?? (() => holderKeyReal()),
    now: deps.now ?? (() => Date.now()),
  };
}

function appQueryOf(operation: Record<string, unknown>): string {
  return typeof operation.app === 'string' ? operation.app : '';
}

/** After an action or get-app-state, cache the snapshot and save its screenshot. */
async function persistSnapshotIfPresent(
  response: HelperResponse,
  operation: Record<string, unknown>,
  resolved: ReturnType<typeof resolvedDeps>,
): Promise<SavedScreenshot | null> {
  const snapshot = (response as { snapshot?: RawSnapshot }).snapshot;
  if (!snapshot) return null;
  await resolved.saveSnapshot(resolved.holderKey(), appQueryOf(operation), {
    snapshotId: snapshot.snapshotId,
    windowIndex: snapshot.windowIndex,
    elements: snapshot.elements as { index: number }[],
  });
  return resolved.saveScreenshot(snapshot);
}

/** Preamble steps 1-4 and 8, shared by every command except `capabilities` and `release`. */
export async function runComputerOperation(
  input: RunComputerOperationInput,
  deps: RunDeps = {},
): Promise<RunComputerOperationResult> {
  const resolved = resolvedDeps(deps);

  const platformId = resolved.detectPlatform();
  const provider = resolved.providerFor(platformId);
  if (!provider) {
    throw new ComputerUseError('unsupported_platform', unsupportedMessage(platformId, resolved.platform));
  }
  if (!resolved.loadConfig().computerUse.enabled) {
    throw new ComputerUseError('disabled', DISABLED_MESSAGE);
  }
  const sessionResult = await provider.resolveSession();
  if (!sessionResult.ok) {
    throw new ComputerUseError(sessionResult.code, sessionResult.message);
  }

  return resolved.withDesktopLock(async () => {
    if (input.kind === 'input') await resolved.claimLease(resolved.now());
    const response = await provider.runHelper(input.operation, sessionResult.session);
    const screenshot = await persistSnapshotIfPresent(response, input.operation, resolved);
    return { response, screenshot };
  });
}

export interface CapabilitiesResult {
  platform: NodeJS.Platform;
  enabled: boolean;
  desktopSession: { ok: true; sessionType?: string; display?: string; label?: string } | { ok: false; message: string };
  helper: Record<string, unknown> | null;
  helperError?: string;
}

/**
 * Under WSL2 the session is the Windows desktop: WSLg's XDG_SESSION_TYPE and
 * DISPLAY describe the wrong desktop, so they are never reported (PAN-5462 FR-1).
 * One windowsVersion() call supplies the build; readiness() is not called because
 * it would run a second handshake. A failed version probe keeps the bare label.
 */
async function windowsSession(fallbackLabel: string, deps: RunDeps): Promise<{ ok: true; label: string }> {
  try {
    const { build } = await (deps.windowsVersion ?? (() => windowsVersionReal()))();
    return { ok: true, label: `windows · ${build}` };
  } catch {
    return { ok: true, label: fallbackLabel };
  }
}

/** FR-13: never refuses. Reports platform/enabled/desktop-session state and, with a provider and a desktop, the helper's handshake. */
export async function runCapabilities(deps: RunDeps = {}): Promise<CapabilitiesResult> {
  const resolved = resolvedDeps(deps);
  const enabled = resolved.loadConfig().computerUse.enabled;

  const platformId = resolved.detectPlatform();
  const provider = resolved.providerFor(platformId);
  if (!provider) {
    return {
      platform: resolved.platform,
      enabled,
      desktopSession: { ok: false, message: unsupportedMessage(platformId, resolved.platform) },
      helper: null,
    };
  }

  const sessionResult = await provider.resolveSession();
  if (!sessionResult.ok) {
    return { platform: resolved.platform, enabled, desktopSession: { ok: false, message: sessionResult.message }, helper: null };
  }

  const { session } = sessionResult;
  const desktopSession: CapabilitiesResult['desktopSession'] =
    provider.id === 'wsl'
      ? await windowsSession(session.label, deps)
      : {
          ok: true as const,
          sessionType: session.env.XDG_SESSION_TYPE,
          display: session.env.DISPLAY ?? session.env.WAYLAND_DISPLAY,
        };

  try {
    const response = await resolved.withDesktopLock(() => provider.runHelper({ tool: 'handshake' }, session));
    return { platform: resolved.platform, enabled, desktopSession, helper: (response as { capabilities?: Record<string, unknown> }).capabilities ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { platform: resolved.platform, enabled, desktopSession, helper: null, helperError: message };
  }
}

/** Skips every other preamble step: just releases the lease under the lock. */
export async function runRelease(options: { force?: boolean } = {}, deps: RunDeps = {}): Promise<void> {
  const resolved = resolvedDeps(deps);
  await resolved.withDesktopLock(() => resolved.releaseLease(options));
}
