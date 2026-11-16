/**
 * The guarded preamble every `pan computer` command goes through (PAN-5452,
 * PRD 3h). This file covers preamble steps 1-4 and 8, plus the two commands
 * that skip most of it: `capabilities` (FR-13, never refuses) and `release`.
 * Steps 5-7 (key checks, stdin, element resolution) live in commands.ts,
 * which builds the operation and calls `runComputerOperation`.
 */
import { loadConfigSync } from '../config-yaml.js';
import { resolveDesktopEnv as resolveDesktopEnvReal, type ResolveDesktopEnvDeps } from './desktop-env.js';
import { ComputerUseError } from './errors.js';
import type { RawSnapshot } from './format.js';
import { type HelperResponse, runHelper as runHelperReal } from './helper.js';
import {
  claimLease as claimLeaseReal,
  holderKey as holderKeyReal,
  releaseLease as releaseLeaseReal,
  withDesktopLock as withDesktopLockReal,
} from './lease.js';
import { type SavedScreenshot, saveScreenshot as saveScreenshotReal, saveSnapshot as saveSnapshotReal } from './snapshot-store.js';

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
  resolveDesktopEnv?: (deps?: ResolveDesktopEnvDeps) => ReturnType<typeof resolveDesktopEnvReal>;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  claimLease?: (now: number) => Promise<void>;
  releaseLease?: (options: { force?: boolean }) => Promise<void>;
  runHelper?: (operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<HelperResponse>;
  saveSnapshot?: typeof saveSnapshotReal;
  saveScreenshot?: typeof saveScreenshotReal;
  holderKey?: () => string;
  now?: () => number;
}

const DISABLED_MESSAGE =
  'Computer use is off. The operator turns it on with computer_use: { enabled: true } in ~/.overdeck/config.yaml.';

function resolvedDeps(deps: RunDeps) {
  return {
    platform: deps.platform ?? process.platform,
    loadConfig: deps.loadConfig ?? (() => loadConfigSync().config),
    resolveDesktopEnv: deps.resolveDesktopEnv ?? ((d?: ResolveDesktopEnvDeps) => resolveDesktopEnvReal(d)),
    withDesktopLock: deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn)),
    claimLease: deps.claimLease ?? ((now: number) => claimLeaseReal(now)),
    releaseLease: deps.releaseLease ?? ((options: { force?: boolean }) => releaseLeaseReal(options)),
    runHelper: deps.runHelper ?? ((operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => runHelperReal(operation, env)),
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

  if (resolved.platform !== 'linux') {
    throw new ComputerUseError(
      'unsupported_platform',
      `Computer use supports Linux desktops only for now (this host is ${resolved.platform}).`,
    );
  }
  if (!resolved.loadConfig().computerUse.enabled) {
    throw new ComputerUseError('disabled', DISABLED_MESSAGE);
  }
  const envResult = await resolved.resolveDesktopEnv();
  if (!envResult.ok) {
    throw new ComputerUseError(envResult.code, envResult.message);
  }

  return resolved.withDesktopLock(async () => {
    if (input.kind === 'input') await resolved.claimLease(resolved.now());
    const response = await resolved.runHelper(input.operation, envResult.env);
    const screenshot = await persistSnapshotIfPresent(response, input.operation, resolved);
    return { response, screenshot };
  });
}

export interface CapabilitiesResult {
  platform: NodeJS.Platform;
  enabled: boolean;
  desktopSession: { ok: true; sessionType?: string; display?: string } | { ok: false; message: string };
  helper: Record<string, unknown> | null;
  helperError?: string;
}

/** FR-13: never refuses. Reports platform/enabled/desktop-session state and, on Linux with a desktop, the helper's handshake. */
export async function runCapabilities(deps: RunDeps = {}): Promise<CapabilitiesResult> {
  const resolved = resolvedDeps(deps);
  const enabled = resolved.loadConfig().computerUse.enabled;

  if (resolved.platform !== 'linux') {
    return {
      platform: resolved.platform,
      enabled,
      desktopSession: { ok: false, message: `Computer use supports Linux desktops only for now (this host is ${resolved.platform}).` },
      helper: null,
    };
  }

  const envResult = await resolved.resolveDesktopEnv();
  if (!envResult.ok) {
    return { platform: resolved.platform, enabled, desktopSession: { ok: false, message: envResult.message }, helper: null };
  }

  const desktopSession = {
    ok: true as const,
    sessionType: envResult.env.XDG_SESSION_TYPE,
    display: envResult.env.DISPLAY ?? envResult.env.WAYLAND_DISPLAY,
  };

  try {
    const response = await resolved.withDesktopLock(() => resolved.runHelper({ tool: 'handshake' }, envResult.env));
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
