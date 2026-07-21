/** Lowercase check-name prefixes that provide advisory context but never gate merges. */
export const ADVISORY_CHECK_NAMES = new Set(['coderabbit']);

export function isAdvisoryCheckName(name: string | null | undefined): boolean {
  const normalized = name?.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized != null && [...ADVISORY_CHECK_NAMES].some((advisory) => normalized.startsWith(advisory));
}
