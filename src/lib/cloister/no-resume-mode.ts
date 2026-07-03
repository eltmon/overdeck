import { RESUME_GATE_SOURCE_ENV } from '../boot-gates.js';

const TRUTHY_NO_RESUME_VALUES = new Set(['1', 'true', 'yes']);

let noResumeModeSince: string | null = null;

export function isNoResumeValueEnabled(value: string | undefined): boolean {
  return TRUTHY_NO_RESUME_VALUES.has(value?.trim().toLowerCase() ?? '');
}

/**
 * PAN-2278: boot-gates stamps OVERDECK_NO_RESUME=1 on every boot that does not
 * pass --resume (PAN-1963 default-off) and records why in
 * OVERDECK_RESUME_GATE_SOURCE ('flag' | 'env' | 'default'). Only a flag
 * (--no-resume) or an operator-exported env is an explicit no-resume request;
 * the 'default' stamp must reach boot reconciliation's pending/dialog path
 * instead of short-circuiting to hold_all.
 */
export function isExplicitNoResumeRequest(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isNoResumeValueEnabled(env.OVERDECK_NO_RESUME)) return false;
  return env[RESUME_GATE_SOURCE_ENV]?.trim().toLowerCase() !== 'default';
}

export function isNoResumeCliOptionEnabled(options: { noResume?: boolean; resume?: boolean }): boolean {
  return options.noResume === true || options.resume === false;
}

export function getNoResumeMode(): { active: boolean; since: string | null } {
  const active = isNoResumeValueEnabled(process.env.OVERDECK_NO_RESUME);
  if (!active) {
    noResumeModeSince = null;
    return { active: false, since: null };
  }

  noResumeModeSince ??= new Date().toISOString();
  return { active: true, since: noResumeModeSince };
}
