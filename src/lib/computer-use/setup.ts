/**
 * The Setup button's orchestrator (PAN-5461, PRD WI-4b).
 *
 * Runs the steps buildStatus lists, in order: the provider's own steps
 * (install packages, turn on accessibility), then enable-flag (writes
 * computer_use.enabled through the settings door), then test-helper (a
 * handshake under the desktop lock). It stops at the first failed or waiting
 * step, so the flag is only turned on once every earlier step succeeded.
 * One setup runs at a time per process; a second call throws
 * SetupInProgressError (route → 409).
 */
import { withDesktopLock as withDesktopLockReal } from './lease.js';
import { detectPlatform as detectPlatformReal, providerFor as providerForReal } from './platform.js';
import type { ComputerUsePlatformId, SetupStepId } from './platform-types.js';
import { saveComputerUseSettings } from './settings.js';
import { buildStatus as buildStatusReal, type ComputerUseStatusView } from './status.js';

export interface SetupStepReport {
  id: SetupStepId;
  label: string;
  status: 'done' | 'skipped' | 'failed' | 'waiting';
  message?: string;
  command?: string;
}

export interface SetupResult {
  ok: boolean;
  steps: SetupStepReport[];
  status: ComputerUseStatusView;
  message?: string;
}

export class SetupInProgressError extends Error {
  constructor(message = 'Setup is already running') {
    super(message);
    this.name = 'SetupInProgressError';
  }
}

export interface SetupDeps {
  buildStatus?: (options: { probeHelper: 'wait' | 'if-free' }) => Promise<ComputerUseStatusView>;
  detectPlatform?: () => ComputerUsePlatformId | 'unsupported';
  providerFor?: typeof providerForReal;
  saveSettings?: (input: { enabled: boolean }) => Promise<{ enabled: boolean }>;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

let inFlight: Promise<SetupResult> | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSetupOnce(deps: SetupDeps): Promise<SetupResult> {
  const buildStatus = deps.buildStatus ?? ((options: { probeHelper: 'wait' | 'if-free' }) => buildStatusReal(options));
  const provider = (deps.providerFor ?? providerForReal)((deps.detectPlatform ?? (() => detectPlatformReal()))());
  const saveSettings = deps.saveSettings ?? ((input: { enabled: boolean }) => saveComputerUseSettings(input));
  const withDesktopLock = deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn));

  const status = await buildStatus({ probeHelper: 'if-free' });
  if (!provider || !status.supported || !status.session.ok) {
    return { ok: false, steps: [], status, message: "Computer use isn't available on this host." };
  }

  const steps: SetupStepReport[] = [];
  for (const step of status.setupSteps) {
    let report: SetupStepReport;
    if (step.id === 'enable-flag') {
      try {
        await saveSettings({ enabled: true });
        report = { id: step.id, label: step.label, status: 'done' };
      } catch (error) {
        report = { id: step.id, label: step.label, status: 'failed', message: errorMessage(error) };
      }
    } else if (step.id === 'test-helper') {
      report = { id: step.id, label: step.label, status: 'failed' };
      try {
        const sessionResult = await provider.resolveSession();
        if (!sessionResult.ok) {
          report.message = sessionResult.message;
        } else {
          const response = await withDesktopLock(() => provider.runHelper({ tool: 'handshake' }, sessionResult.session));
          if (response.ok === true) report = { id: step.id, label: step.label, status: 'done' };
          else report.message = typeof response.error === 'string' ? response.error : 'The helper handshake failed.';
        }
      } catch (error) {
        report.message = errorMessage(error);
      }
    } else {
      try {
        const result = await provider.runSetupStep(step.id);
        report = { id: step.id, label: step.label, ...result };
      } catch (error) {
        report = { id: step.id, label: step.label, status: 'failed', message: errorMessage(error) };
      }
    }
    steps.push(report);
    if (report.status === 'failed' || report.status === 'waiting') break;
  }

  const ok = steps.every((step) => step.status === 'done' || step.status === 'skipped');
  return { ok, steps, status: await buildStatus({ probeHelper: 'if-free' }) };
}

/** Runs the listed setup steps (FR-5). Throws SetupInProgressError while another run is in flight (FR-13). */
export async function runSetup(deps: SetupDeps = {}): Promise<SetupResult> {
  if (inFlight) throw new SetupInProgressError();
  const run = runSetupOnce(deps);
  inFlight = run;
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}
