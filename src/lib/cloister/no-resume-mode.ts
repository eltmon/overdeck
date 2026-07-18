import { RESUME_GATE_SOURCE_ENV } from '../boot-gates.js';

const TRUTHY_NO_RESUME_VALUES = new Set(['1', 'true', 'yes']);

let noResumeModeSince: string | null = null;

export function isNoResumeValueEnabled(value: string | undefined): boolean {
  return TRUTHY_NO_RESUME_VALUES.has(value?.trim().toLowerCase() ?? '');
}

/**
 * PAN-2278: boot-gates records the resume-gate provenance in
 * OVERDECK_RESUME_GATE_SOURCE ('flag' | 'env' | 'default'). Auto-resume is now
 * ON by default (operator decision 2026-07-18), so a plain boot stamps
 * OVERDECK_RESUME=1 (source 'default') and this predicate returns false — boot
 * reconciliation opens the operator popup instead of holding. Only an explicit
 * opt-out — a flag (--no-resume) or an operator-exported OVERDECK_NO_RESUME —
 * is an explicit no-resume request that short-circuits boot reconciliation to
 * hold_all. The source!=='default' guard stays defensive: an inherited
 * NO_RESUME without provenance resolves to source 'env', still explicit.
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
