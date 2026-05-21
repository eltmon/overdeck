/**
 * vBRIEF Lifecycle Foundation
 *
 * Filesystem-as-state lifecycle model for scope vBRIEFs. Each registered
 * project gets a `./vbrief/` directory at its repo root with four lifecycle
 * subdirectories that act as the source of truth for plan status:
 *
 *   ./vbrief/proposed/   — planning complete, awaiting approval
 *   ./vbrief/active/     — agent is working on it
 *   ./vbrief/completed/  — merged/closed, immutable archive
 *   ./vbrief/cancelled/  — abandoned, immutable archive
 *
 * Filenames are issue-keyed: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json` where
 * the date is the immutable creation date. Issue ID gives Panopticon ergonomics
 * (one vBRIEF per issue) and slug gives human readability.
 */

import { mkdirSync } from 'fs';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { Effect } from 'effect';
import { FsError } from '../errors.js';

export const VBRIEF_ROOT_DIRNAME = 'vbrief';

export const VBRIEF_LIFECYCLE_DIRS = ['proposed', 'active', 'completed', 'cancelled'] as const;

export type VBriefLifecycleDir = typeof VBRIEF_LIFECYCLE_DIRS[number];

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-([A-Za-z][A-Za-z0-9]*-\d+)-([a-z0-9-]+)\.vbrief\.json$/;

/**
 * Slugify an arbitrary string for use in a vBRIEF filename. Lowercases,
 * replaces non-alphanumeric runs with single dashes, trims leading/trailing
 * dashes, and collapses repeats.
 */
export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return cleaned || 'plan';
}

/**
 * Format a JS Date (or ISO string / YYYY-MM-DD) as YYYY-MM-DD in UTC.
 */
function formatDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date: ${String(value)}`);
  }
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Generate the canonical vBRIEF filename for an issue.
 *
 * Format: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`
 * Example: `2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json`
 *
 * @param issueId - Issue identifier in the form `PREFIX-NUMBER` (e.g. `PAN-946`).
 *                  Normalized to uppercase in the filename — issue IDs are
 *                  uppercase by convention, and case-preservation let a
 *                  lowercased caller produce a duplicate, case-colliding
 *                  spec file (PAN-1050).
 * @param slug    - Free-form slug (will be normalized via slugify).
 * @param createdDate - Date or ISO string used for the YYYY-MM-DD prefix.
 *                      Defaults to "now". Always interpreted in UTC so filenames
 *                      are stable across timezones.
 */
export function generateVBriefFilename(
  issueId: string,
  slug: string,
  createdDate: Date | string = new Date(),
): string {
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(issueId)) {
    throw new Error(`Invalid issue ID for vBRIEF filename: ${issueId} (expected e.g. PAN-946)`);
  }
  // Issue IDs are uppercase by convention (PAN-, MIN-, AUR-). Normalize so a
  // lowercased issueId from an upstream caller cannot produce a second spec
  // file that case-collides with the canonical one (PAN-1050).
  const canonicalIssueId = issueId.toUpperCase();
  const date = formatDate(createdDate);
  const normalized = slugify(slug);
  return `${date}-${canonicalIssueId}-${normalized}.vbrief.json`;
}

/**
 * Parse a canonical vBRIEF filename back into its parts. Returns null if the
 * filename doesn't match the convention so callers can ignore stray files.
 */
export function parseVBriefFilename(filename: string): { issueId: string; slug: string; date: string } | null {
  const match = filename.match(FILENAME_RE);
  if (!match) return null;
  return { date: match[1], issueId: match[2], slug: match[3] };
}

/**
 * Resolve the absolute path of a specific lifecycle directory under a project's
 * vBRIEF root. Pure path math — does not check existence or create dirs.
 *
 * @param vbriefDirname - Override the default "vbrief" dirname (from projects.yaml `vbrief_dir`).
 */
export function resolveVBriefDir(projectRoot: string, lifecycleDir: VBriefLifecycleDir, vbriefDirname?: string): string {
  return join(projectRoot, vbriefDirname || VBRIEF_ROOT_DIRNAME, lifecycleDir);
}

/**
 * Resolve the absolute path to a project's vBRIEF root directory (without a
 * lifecycle subdirectory). Pure path math.
 */
export function resolveVBriefRoot(projectRoot: string, vbriefDirname?: string): string {
  return join(projectRoot, vbriefDirname || VBRIEF_ROOT_DIRNAME);
}

/**
 * Ensure the vBRIEF lifecycle directories exist under the given project root.
 * Returns the absolute path to the vBRIEF root. Idempotent.
 *
 * @param vbriefDirname - Override the default "vbrief" dirname (from projects.yaml `vbrief_dir`).
 */
export function ensureVBriefDirs(projectRoot: string, vbriefDirname?: string): string {
  const root = join(projectRoot, vbriefDirname || VBRIEF_ROOT_DIRNAME);
  mkdirSync(root, { recursive: true });
  for (const dir of VBRIEF_LIFECYCLE_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of `ensureVBriefDirs`. Uses fs/promises so dashboard server
 * routes can create the vBRIEF lifecycle directories without blocking the
 * Node.js event loop. Idempotent.
 */
export const ensureVBriefDirsEffect = (
  projectRoot: string,
  vbriefDirname?: string,
): Effect.Effect<string, FsError> =>
  Effect.gen(function* () {
    const root = join(projectRoot, vbriefDirname || VBRIEF_ROOT_DIRNAME);
    yield* Effect.tryPromise({
      try: () => mkdir(root, { recursive: true }),
      catch: (cause) => new FsError({ path: root, operation: 'mkdir', cause }),
    });
    for (const dir of VBRIEF_LIFECYCLE_DIRS) {
      const lifecycleDir = join(root, dir);
      yield* Effect.tryPromise({
        try: () => mkdir(lifecycleDir, { recursive: true }),
        catch: (cause) => new FsError({ path: lifecycleDir, operation: 'mkdir', cause }),
      });
    }
    return root;
  });
