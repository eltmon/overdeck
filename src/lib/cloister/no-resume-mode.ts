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

/**
 * Clear no-resume mode in the running process so the Deacon's patrols and
 * lifecycle-event handlers begin resuming agents again. `getNoResumeMode()`
 * reads `OVERDECK_NO_RESUME` live on every call, so flipping the env var here
 * takes effect on the next patrol/event without a restart.
 *
 * Mirrors the resume-enabled branch of `applyBootGateEnv` in boot-gates.ts
 * (delete OVERDECK_NO_RESUME, set OVERDECK_RESUME=1). This is in-process only:
 * PAN-1963 makes no-resume the safe default at every boot, so a future restart
 * correctly returns to no-resume mode until the operator opts back in. The
 * dashboard "Resume all" button is the sole caller.
 */
export function disableNoResumeMode(): void {
  delete process.env.OVERDECK_NO_RESUME;
  process.env.OVERDECK_RESUME = '1';
  noResumeModeSince = null;
}
