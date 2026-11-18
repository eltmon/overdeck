/**
 * Computer-use platform provider seam types (PAN-5461, PRD WI-1a, D-10).
 *
 * Providers and their helper modules import these types from here, never from
 * platform.ts: platform.ts imports every provider, and lint:circular counts
 * `import type` edges.
 */
import type { HelperResponse } from './helper.js';

export type ComputerUsePlatformId = 'linux' | 'wsl' | 'darwin';

export type ReadinessStatus = 'ok' | 'action' | 'missing' | 'unavailable';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  /** One short sentence, e.g. "x11 · display :1" or "Not importable". */
  detail: string;
  /** Shown only when setup can't do it for the operator. */
  fixCommand?: string;
}

/** A session the provider resolved. Callers use `label`; run.ts's capabilities report also reads XDG_SESSION_TYPE and DISPLAY/WAYLAND_DISPLAY from `env`. */
export interface ProviderSession {
  label: string; // e.g. "x11 · display :1"
  env: NodeJS.ProcessEnv; // env the helper runs with
}

export type SetupStepId =
  | 'install-packages'
  | 'enable-accessibility'
  | 'grant-permissions'
  | 'enable-flag'
  | 'test-helper';

export interface SetupStep {
  id: SetupStepId;
  label: string; // e.g. "Install xdotool xclip"
  needsPassword?: boolean; // shows "your system will ask for your password once"
}

export interface SetupStepResult {
  /** 'waiting' = the operator must act outside Overdeck (e.g. macOS permission toggles); setup stops and the button becomes "Continue". */
  status: 'done' | 'skipped' | 'failed' | 'waiting';
  message?: string; // done: optional note; failed/waiting: what happened + what to do
  command?: string; // a shell command the operator can copy (shown with a Copy button)
}

export interface ReadinessReport {
  session: { ok: true; label: string } | { ok: false; message: string };
  checks: ReadinessCheck[];
  /** Provider steps the Setup button would run now, in order. Never includes enable-flag or test-helper (status.ts adds them). */
  setupSteps: SetupStep[];
}

export type KeyPlatform = 'linux' | 'windows' | 'mac';

export interface ComputerUseProvider {
  id: ComputerUsePlatformId;
  resolveSession(): Promise<
    | { ok: true; session: ProviderSession }
    | { ok: false; code: 'no_desktop_session'; message: string }
  >;
  readiness(options: { probeHelper: 'wait' | 'if-free' }): Promise<ReadinessReport>;
  runSetupStep(id: Exclude<SetupStepId, 'enable-flag' | 'test-helper'>): Promise<SetupStepResult>;
  runHelper(operation: Record<string, unknown>, session: ProviderSession): Promise<HelperResponse>;
  /** Blocked shortcut rules for this platform (see blocked-key-combos.ts). */
  blockedKeyPlatform: KeyPlatform;
}
