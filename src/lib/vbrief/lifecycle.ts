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
import { join } from 'path';

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
 *                  Case-preserved in the filename so trackers stay readable.
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
  const date = formatDate(createdDate);
  const normalized = slugify(slug);
  return `${date}-${issueId}-${normalized}.vbrief.json`;
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
 * `./vbrief/` root. Pure path math — does not check existence or create dirs.
 */
export function resolveVBriefDir(projectRoot: string, lifecycleDir: VBriefLifecycleDir): string {
  return join(projectRoot, VBRIEF_ROOT_DIRNAME, lifecycleDir);
}

/**
 * Ensure the `./vbrief/{proposed,active,completed,cancelled}/` lifecycle
 * directories exist under the given project root. Returns the absolute path
 * to the `./vbrief/` root. Idempotent.
 */
export function ensureVBriefDirs(projectRoot: string): string {
  const root = join(projectRoot, VBRIEF_ROOT_DIRNAME);
  mkdirSync(root, { recursive: true });
  for (const dir of VBRIEF_LIFECYCLE_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  return root;
}
