export type BootGateSource = 'flag' | 'env' | 'default';

export type BootGateOptions = {
  deacon?: boolean;
  resume?: boolean;
  noResume?: boolean;
};

export type BootGateState = {
  deacon: { enabled: boolean; source: BootGateSource };
  resume: { enabled: boolean; source: BootGateSource };
};

const TRUTHY_GATE_VALUES = new Set(['1', 'true', 'yes']);

export const DEACON_GATE_SOURCE_ENV = 'OVERDECK_DEACON_GATE_SOURCE';
export const RESUME_GATE_SOURCE_ENV = 'OVERDECK_RESUME_GATE_SOURCE';

function isTruthyGateValue(value: string | undefined): boolean {
  return TRUTHY_GATE_VALUES.has(value?.trim().toLowerCase() ?? '');
}

function gateSourceFromEnv(value: string | undefined): BootGateSource | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'flag' || normalized === 'env' || normalized === 'default') return normalized;
  return null;
}

export function resolveBootGates(
  options: BootGateOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): BootGateState {
  const explicitNoResume = options.noResume === true || options.resume === false;
  const deaconEnvDisabled = isTruthyGateValue(env.OVERDECK_DISABLE_DEACON);
  const resumeEnvDisabled = isTruthyGateValue(env.OVERDECK_NO_RESUME);
  const resumeEnvEnabled = isTruthyGateValue(env.OVERDECK_RESUME);
  const deaconSource = gateSourceFromEnv(env[DEACON_GATE_SOURCE_ENV]);
  const resumeSource = gateSourceFromEnv(env[RESUME_GATE_SOURCE_ENV]);

  const deacon = options.deacon === true
    ? { enabled: true, source: 'flag' as const }
    : options.deacon === false
      ? { enabled: false, source: 'flag' as const }
      : {
          enabled: !deaconEnvDisabled,
          source: deaconSource ?? (deaconEnvDisabled ? 'env' as const : 'default' as const),
        };

  // Agent auto-resume is ON by default (operator decision 2026-07-18, reversing
  // the PAN-1963 default-off). A dashboard restart never touches live agents —
  // running tmux sessions survive and are not reconciliation candidates. Stopped
  // agents are still gated at boot by the operator popup (boot reconciliation
  // opens the grace window in `pending`; a timeout with no answer resolves to
  // `hold_all`, so nothing floods unattended). With resume on, the steady-state
  // deacon patrols also auto-resume crashed/stopped agents mid-run. Opt out with
  // `--no-resume` / OVERDECK_NO_RESUME=1 (an explicit no-resume still fast-paths
  // boot reconciliation to hold_all).
  const resume = options.resume === true
    ? { enabled: true, source: 'flag' as const }
    : explicitNoResume
      ? { enabled: false, source: 'flag' as const }
      : resumeEnvDisabled
        ? { enabled: false, source: resumeSource ?? 'env' as const }
        : resumeEnvEnabled
          ? { enabled: true, source: resumeSource ?? 'env' as const }
          : { enabled: true, source: resumeSource ?? 'default' as const };

  return { deacon, resume };
}

export function applyBootGateEnv(
  env: NodeJS.ProcessEnv,
  options: BootGateOptions = {},
): NodeJS.ProcessEnv {
  const gates = resolveBootGates(options, env);

  if (gates.deacon.enabled) {
    delete env.OVERDECK_DISABLE_DEACON;
  } else {
    env.OVERDECK_DISABLE_DEACON = '1';
  }
  env[DEACON_GATE_SOURCE_ENV] = gates.deacon.source;

  if (gates.resume.enabled) {
    // Default is ON, so absence already means on — but stamp OVERDECK_RESUME=1
    // explicitly (and clear any inherited OVERDECK_NO_RESUME) so child processes
    // and code that reads the raw env resolve resume unambiguously.
    delete env.OVERDECK_NO_RESUME;
    env.OVERDECK_RESUME = '1';
  } else {
    delete env.OVERDECK_RESUME;
    env.OVERDECK_NO_RESUME = '1';
  }
  env[RESUME_GATE_SOURCE_ENV] = gates.resume.source;

  return env;
}

export function formatBootGateState(state: BootGateState): string {
  return `deacon=${state.deacon.enabled ? 'on' : 'off'} source=${state.deacon.source} ` +
    `resume=${state.resume.enabled ? 'on' : 'off'} source=${state.resume.source}`;
}
