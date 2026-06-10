const TRANSIENT_BD_ERRNO_CODES = new Set(['EAGAIN', 'EBUSY', 'EWOULDBLOCK']);

const TRANSIENT_BD_LOCK_PATTERNS = [
  /\bdatabase is locked\b/i,
  /\block held\b/i,
  /\bfile is locked\b/i,
  /\bresource temporarily unavailable\b/i,
  /\bcould not acquire\b[^\n\r]*\block\b/i,
  /\bfailed to acquire\b[^\n\r]*\block\b/i,
  /\bunable to acquire\b[^\n\r]*\block\b/i,
  /\bcould not obtain\b[^\n\r]*\block\b/i,
  /\banother process\b[^\n\r]*\block/i,
];

type ErrorLikeRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorLikeRecord {
  return typeof value === 'object' && value !== null;
}

function pushString(parts: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim().length > 0) {
    parts.push(value);
  }
}

function collectErrorText(error: unknown, parts: string[] = [], seen = new Set<unknown>()): string {
  if (error == null || seen.has(error)) return parts.join('\n');
  seen.add(error);

  if (typeof error === 'string') {
    pushString(parts, error);
    return parts.join('\n');
  }

  if (!isRecord(error)) return parts.join('\n');

  pushString(parts, error.stderr);
  pushString(parts, error.message);
  pushString(parts, error.stdout);

  collectErrorText(error.cause, parts, seen);
  return parts.join('\n');
}

function hasTransientErrnoCode(error: unknown, seen = new Set<unknown>()): boolean {
  if (error == null || seen.has(error)) return false;
  seen.add(error);

  if (!isRecord(error)) return false;

  if (typeof error.code === 'string' && TRANSIENT_BD_ERRNO_CODES.has(error.code)) {
    return true;
  }

  return hasTransientErrnoCode(error.cause, seen);
}

/**
 * Return true only for bd/Dolt lock-contention failures worth retrying.
 *
 * PAN-1629 reproduction note: the issue was triggered by concurrent `pan start`
 * processes whose `bd list --json -l pan-<id> --status all --limit 0` child
 * process failed while another process held the embedded Dolt DB lock. A local
 * throwaway repo stress run (`.pan/tmp/bd-lock-repro-*`, 2026-06-10) exercised
 * concurrent `bd list`/`bd create`; bd 1.0.4 serialized cleanly in that run, so
 * this predicate is intentionally limited to the exact embedded-Dolt text
 * documented by Beads for this condition (`database is locked`) plus equivalent
 * OS lock-acquisition phrases (`resource temporarily unavailable`, `could not
 * acquire ... lock`). Successful empty results are exit 0 + `[]`, not errors,
 * and must remain non-transient.
 */
export function isTransientBdError(error: unknown): boolean {
  if (error == null) return false;

  const text = collectErrorText(error);
  if (TRANSIENT_BD_LOCK_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return hasTransientErrnoCode(error);
}
