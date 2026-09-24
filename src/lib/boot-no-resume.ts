/**
 * Boot-time no-resume mode helpers. Pure CLI-option/env-var parsing plus the
 * one-shot "since" stamp used by the boot status line — no state-layer
 * dependency. Was misfiled under cloister/ pre-cut (PAN-3917); relocated here
 * since callers span the CLI and backlog machinery, not just cloister.
 */

const TRUTHY_NO_RESUME_VALUES = new Set(['1', 'true', 'yes']);

let noResumeModeSince: string | null = null;

export function isNoResumeValueEnabled(value: string | undefined): boolean {
  return TRUTHY_NO_RESUME_VALUES.has(value?.trim().toLowerCase() ?? '');
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
