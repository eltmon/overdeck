const TRUTHY_NO_RESUME_VALUES = new Set(['1', 'true', 'yes']);

const NO_RESUME_MODE_ACTIVE = isNoResumeValueEnabled(process.env.PANOPTICON_NO_RESUME);
const NO_RESUME_MODE_SINCE = NO_RESUME_MODE_ACTIVE ? new Date().toISOString() : null;

export function isNoResumeValueEnabled(value: string | undefined): boolean {
  return TRUTHY_NO_RESUME_VALUES.has(value?.trim().toLowerCase() ?? '');
}

export function getNoResumeMode(): { active: boolean; since: string | null } {
  return {
    active: NO_RESUME_MODE_ACTIVE,
    since: NO_RESUME_MODE_SINCE,
  };
}
