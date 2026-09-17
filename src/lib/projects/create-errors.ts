/**
 * Typed project-creation failures and the one place raw Git output is sanitized
 * (PAN-3836 WI-1.3).
 *
 * Everything that can fail while creating a project — the remote probe, the
 * clone, the job runtime, the routes, the CLI, and recovery — reports through
 * `ProjectCreateFailure`. The point is that callers stop parsing error strings:
 * the UI decides what to render from `code` and `recovery`, not from a regex
 * over a message it hopes git still produces next release.
 *
 * Two rules hold everywhere in this module:
 *
 *   1. **Nothing raw escapes.** Git echoes the URL the operator typed, which is
 *      the single most likely place for a live token to appear
 *      (`https://user:ghp_…@host/repo.git`). Credentials are stripped and ANSI
 *      removed before any string is returned, logged, or stored on a job — not
 *      at the render site, where one forgotten call leaks it.
 *   2. **`detail` is bounded.** `git clone --progress` writes a carriage-return
 *      progress line continuously; a long clone produces hundreds of KB nobody
 *      will read. We keep a 4 KiB tail, which is where the actual error is.
 *
 * `retrySafe` answers one question and it is not "did this fail?": it is "can
 * the operator press the button again without risking a second clone or a
 * duplicate registration?". A cancelled clone whose cleanup has settled is
 * retry-safe; a registration that died halfway is not — it needs Finish setup.
 */

export type ProjectCreateFailureCode =
  | 'authentication-required'
  | 'host-key-untrusted'
  | 'remote-unreachable'
  | 'destination-conflict'
  | 'cancelled'
  | 'timed-out'
  | 'setup-incomplete'
  | 'operation-unknown'
  | 'internal-error';

export type ProjectCreateRecovery =
  | { action: 'finish-setup'; key: string; path: string }
  | { action: 'use-existing'; path: string };

export interface ProjectCreateFailure {
  code: ProjectCreateFailureCode;
  message: string;
  /** Sanitized and bounded; rendered only behind a disclosure. */
  detail?: string;
  retrySafe: boolean;
  recovery?: ProjectCreateRecovery;
}

/** Keep the last 4 KiB of diagnostic output; the error is always at the end. */
export const MAX_DETAIL_BYTES = 4096;

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/**
 * `scheme://user:secret@host` → `scheme://host`.
 *
 * Both halves of the userinfo go: a bare username is not a secret, but it is
 * still the operator's identity being echoed into a log nobody audits.
 */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi;

/**
 * `Authorization: Bearer …` and friends, when a transport helper echoes one.
 * Consumes to end of line: a token scheme like `Bearer` is one word, the secret
 * is the next one, and stopping at the first word leaves the secret behind.
 */
const HEADER_CREDENTIALS = /\b(authorization|private-token|x-auth-token)\s*[:=][^\r\n]*/gi;

/** Remove credentials, ANSI, and control noise from text that may be shown or logged. */
export function sanitizeDiagnostic(raw: string): string {
  return raw
    .replace(ANSI_ESCAPE, '')
    .replace(URL_CREDENTIALS, '$1')
    .replace(HEADER_CREDENTIALS, '$1: [redacted]')
    // Carriage returns are progress repaints, not line breaks; collapsing them
    // keeps a 200-line progress bar from reading as 200 distinct errors.
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Sanitize, then keep only the tail that fits in {@link MAX_DETAIL_BYTES}. */
export function boundedDetail(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const clean = sanitizeDiagnostic(raw);
  if (!clean) return undefined;
  if (Buffer.byteLength(clean, 'utf8') <= MAX_DETAIL_BYTES) return clean;
  const tail = Buffer.from(clean, 'utf8').subarray(-MAX_DETAIL_BYTES).toString('utf8');
  // The slice can land mid-codepoint; drop the partial first line with it.
  return `…${tail.slice(tail.indexOf('\n') + 1)}`;
}

// ─── Category detection ──────────────────────────────────────────────────────
// These read git's own stderr. They are deliberately narrow: a wrong category
// sends the operator to fix the wrong thing, which is worse than a generic
// message. Anything unrecognized stays `internal-error`.

const HOST_KEY_FAILED = /host key verification failed/i;
const PUBLICKEY_DENIED = /permission denied\s*\([^)]*publickey[^)]*\)/i;
const AUTH_FAILED =
  /authentication failed|could not read (?:username|password)|invalid username or password|terminal prompts disabled|403 forbidden|401 unauthorized/i;
const REPO_UNREADABLE = /could not read from remote repository|repository not found|does not appear to be a git repository/i;
const NETWORK_FAILED =
  /could not resolve host|connection (?:refused|timed out|reset)|network is unreachable|failed to connect|operation timed out/i;
const DESTINATION_EXISTS =
  /destination path '([^']*)' already exists and is not an empty directory|already exists and is not an empty directory/i;

/** An ssh(1) diagnostic — a line only the SSH transport can have produced. */
const SSH_TRANSPORT = /\bssh\b|permission denied \(|connection (?:closed|reset|refused|timed out) by/i;

const AUTH_MESSAGE =
  'This server could not authenticate to the repository. Configure credentials on this server, then check again.';
// Only for a proven SSH key failure. Telling an HTTPS user to run ssh-add sends
// them to fix something that was never involved.
const AUTH_SSH_KEY_MESSAGE =
  'This server could not authenticate to the repository with its SSH key. Load the key into the SSH agent on this server (ssh-add), then check again.';
const HOST_KEY_MESSAGE =
  "This server has not trusted the Git host's SSH key. Connect from a trusted shell on this server to verify it, then check again.";
const UNREACHABLE_MESSAGE =
  'The repository could not be reached from this server. Check the URL and connection, then check again.';
const DESTINATION_MESSAGE = 'The destination already contains files.';
const INTERNAL_MESSAGE = 'Project setup failed on the server.';
const TIMEOUT_MESSAGE = 'The clone took too long and was stopped on this server.';
const CANCELLED_MESSAGE = 'The clone was cancelled.';

/**
 * Classify raw Git stderr into a typed failure.
 *
 * `targetPath` is the destination this operation owns; it is used for the
 * destination-conflict recovery action rather than trusting the path git echoed.
 */
export function classifyGitFailure(
  rawStderr: string,
  options: { targetPath?: string | null } = {},
): ProjectCreateFailure {
  const clean = sanitizeDiagnostic(rawStderr ?? '');
  const detail = boundedDetail(rawStderr);

  if (DESTINATION_EXISTS.test(clean)) {
    const path = options.targetPath ?? DESTINATION_EXISTS.exec(clean)?.[1] ?? null;
    return {
      code: 'destination-conflict',
      message: path ? `${DESTINATION_MESSAGE} ${path}` : DESTINATION_MESSAGE,
      detail,
      // Nothing was destroyed and nothing will be: the operator chooses between
      // adding the existing folder and picking another one.
      retrySafe: false,
      ...(path ? { recovery: { action: 'use-existing' as const, path } } : {}),
    };
  }

  if (HOST_KEY_FAILED.test(clean)) {
    return { code: 'host-key-untrusted', message: HOST_KEY_MESSAGE, detail, retrySafe: true };
  }

  if (PUBLICKEY_DENIED.test(clean)) {
    return { code: 'authentication-required', message: AUTH_SSH_KEY_MESSAGE, detail, retrySafe: true };
  }

  if (AUTH_FAILED.test(clean)) {
    return { code: 'authentication-required', message: AUTH_MESSAGE, detail, retrySafe: true };
  }

  if (NETWORK_FAILED.test(clean)) {
    return { code: 'remote-unreachable', message: UNREACHABLE_MESSAGE, detail, retrySafe: true };
  }

  if (REPO_UNREADABLE.test(clean)) {
    // Git prints this same line for an auth failure over SSH and for a genuinely
    // missing repository. Only call it authentication when the transport proves it.
    return SSH_TRANSPORT.test(clean)
      ? { code: 'authentication-required', message: AUTH_MESSAGE, detail, retrySafe: true }
      : { code: 'remote-unreachable', message: UNREACHABLE_MESSAGE, detail, retrySafe: true };
  }

  return { code: 'internal-error', message: INTERNAL_MESSAGE, detail, retrySafe: true };
}

/** A clone the operator cancelled, once its cleanup has settled. */
export function cancelledFailure(detail?: string): ProjectCreateFailure {
  return { code: 'cancelled', message: CANCELLED_MESSAGE, detail: boundedDetail(detail), retrySafe: true };
}

/** A clone that ran past its deadline and was killed. */
export function timedOutFailure(detail?: string): ProjectCreateFailure {
  return { code: 'timed-out', message: TIMEOUT_MESSAGE, detail: boundedDetail(detail), retrySafe: true };
}

/**
 * The repository exists and the project is registered, but setup did not finish.
 *
 * Never retry-safe: creating again would hit the duplicate guard or clone a
 * second copy. The only correct next move is the idempotent repair.
 */
export function setupIncompleteFailure(args: {
  key: string;
  path: string;
  cause?: unknown;
}): ProjectCreateFailure {
  return {
    code: 'setup-incomplete',
    message: `The repository is available at ${args.path}, but project setup did not finish.`,
    detail: boundedDetail(describeCause(args.cause)),
    retrySafe: false,
    recovery: { action: 'finish-setup', key: args.key, path: args.path },
  };
}

/** Neither success nor failure has been proved — the client or the job lost contact. */
export function unknownOutcomeFailure(detail?: string): ProjectCreateFailure {
  return {
    code: 'operation-unknown',
    message: 'The result of this operation is not known on this server.',
    detail: boundedDetail(detail),
    retrySafe: false,
  };
}

/** Wrap any thrown value as a sanitized failure, never leaking a stack or argv. */
export function sanitizeCreationFailure(cause: unknown): ProjectCreateFailure {
  const described = describeCause(cause);
  // A thrown Error from a git child still carries git's wording, so give the
  // classifier first refusal before falling back to a generic internal error.
  const classified = classifyGitFailure(described);
  if (classified.code !== 'internal-error') return classified;
  return {
    code: 'internal-error',
    message: INTERNAL_MESSAGE,
    detail: boundedDetail(described),
    retrySafe: true,
  };
}

/** Extract a message from a thrown value without ever including its stack. */
function describeCause(cause: unknown): string {
  if (cause == null) return '';
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}
