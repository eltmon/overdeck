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

export const DEACON_GATE_SOURCE_ENV = 'PANOPTICON_DEACON_GATE_SOURCE';
export const RESUME_GATE_SOURCE_ENV = 'PANOPTICON_RESUME_GATE_SOURCE';

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
  const deaconEnvDisabled = isTruthyGateValue(env.PANOPTICON_DISABLE_DEACON);
  const resumeEnvDisabled = isTruthyGateValue(env.PANOPTICON_NO_RESUME);
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

  const resume = options.resume === true
    ? { enabled: true, source: 'flag' as const }
    : explicitNoResume
      ? { enabled: false, source: 'flag' as const }
      : {
          enabled: !resumeEnvDisabled,
          source: resumeSource ?? (resumeEnvDisabled ? 'env' as const : 'default' as const),
        };

  return { deacon, resume };
}

export function applyBootGateEnv(
  env: NodeJS.ProcessEnv,
  options: BootGateOptions = {},
): NodeJS.ProcessEnv {
  const gates = resolveBootGates(options, env);

  if (gates.deacon.enabled) {
    delete env.PANOPTICON_DISABLE_DEACON;
  } else {
    env.PANOPTICON_DISABLE_DEACON = '1';
  }
  env[DEACON_GATE_SOURCE_ENV] = gates.deacon.source;

  if (gates.resume.enabled) {
    delete env.PANOPTICON_NO_RESUME;
  } else {
    env.PANOPTICON_NO_RESUME = '1';
  }
  env[RESUME_GATE_SOURCE_ENV] = gates.resume.source;

  return env;
}

export function formatBootGateState(state: BootGateState): string {
  return `deacon=${state.deacon.enabled ? 'on' : 'off'} source=${state.deacon.source} ` +
    `resume=${state.resume.enabled ? 'on' : 'off'} source=${state.resume.source}`;
}
