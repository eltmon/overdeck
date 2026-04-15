/**
 * Retro archiver (PAN-709, bead 4r5)
 *
 * After synthesis files issues and writes FLYWHEEL-REPORT, moves each
 * processed retro to docs/flywheel/retros/archive/run-N/<filename>.
 * Watchlist retros stay in the main directory.
 * After 30 days, a watchlist retro without new signals is archived with
 * a wontfix marker appended to its frontmatter.
 *
 * All file I/O uses fs/promises — no sync calls.
 */

import { promises as fsPromises } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_RETROS_DIR = join(homedir(), 'docs', 'flywheel', 'retros');
const WONTFIX_AGE_DAYS = 30;

// ============================================================================
// Types
// ============================================================================

export interface ArchiveResult {
  /** Paths of retros successfully moved to archive/run-N/. */
  archived: string[];
  /** Paths of watchlist retros aged out with a wontfix marker. */
  wontfixed: string[];
  /** Paths of files that could not be moved (errors logged). */
  errors: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Append a wontfix marker to the YAML frontmatter of a retro file.
 * Inserts `wontfix: true\nwontfix_reason: aged out — no new signals in 30d`
 * before the closing `---` of the frontmatter.
 */
function appendWontfix(content: string): string {
  const fmEnd = content.indexOf('\n---', 4); // skip opening ---
  if (fmEnd === -1) {
    // No closing --- found — just append to the file
    return content + '\nwontfix: true\nwontfix_reason: aged out — no new signals in 30d\n';
  }
  return (
    content.slice(0, fmEnd) +
    '\nwontfix: true\nwontfix_reason: aged out — no new signals in 30d' +
    content.slice(fmEnd)
  );
}

/**
 * Derive the run number from the count of existing archive/run-* directories.
 * Returns 1 on first run.
 */
async function deriveRunNumber(archiveDir: string): Promise<number> {
  try {
    const entries = await fsPromises.readdir(archiveDir);
    const runDirs = entries.filter(e => /^run-\d+$/.test(e));
    if (runDirs.length === 0) return 1;
    const nums = runDirs.map(d => parseInt(d.slice(4), 10)).filter(n => !isNaN(n));
    return Math.max(...nums) + 1;
  } catch {
    return 1;
  }
}

// ============================================================================
// Core
// ============================================================================

/**
 * Archive processed retros to archive/run-N/ and age out stale watchlist entries.
 *
 * @param processedRetroPaths - Absolute paths of retros that were processed
 *   in this synthesis run (i.e., had surprise: true and contributed to proposals).
 * @param retrosDir - Override for the retros directory (default: ~/docs/flywheel/retros/)
 * @returns Summary of what was archived and wontfixed.
 */
export async function archiveProcessedRetros(
  processedRetroPaths: string[],
  retrosDir: string = DEFAULT_RETROS_DIR,
): Promise<ArchiveResult> {
  const archiveBaseDir = join(retrosDir, 'archive');
  const runNumber = await deriveRunNumber(archiveBaseDir);
  const runDir = join(archiveBaseDir, `run-${runNumber}`);

  const archived: string[] = [];
  const wontfixed: string[] = [];
  const errors: string[] = [];

  // Step 1: Move processed retros to archive/run-N/
  if (processedRetroPaths.length > 0) {
    try {
      await fsPromises.mkdir(runDir, { recursive: true });
    } catch (err) {
      console.warn(`[retro-archiver] Failed to create run dir ${runDir}:`, err);
    }

    for (const retroPath of processedRetroPaths) {
      const filename = basename(retroPath);
      const destPath = join(runDir, filename);
      try {
        await fsPromises.rename(retroPath, destPath);
        archived.push(retroPath);
      } catch (err) {
        console.warn(`[retro-archiver] Failed to move ${filename}:`, err);
        errors.push(retroPath);
      }
    }
  }

  // Step 2: Age out stale watchlist retros (> 30 days old, not in processedRetroPaths)
  const processedSet = new Set(processedRetroPaths);
  const cutoffMs = Date.now() - WONTFIX_AGE_DAYS * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await fsPromises.readdir(retrosDir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (entry === 'archive') continue;
    if (!entry.endsWith('.md')) continue;

    const fullPath = join(retrosDir, entry);
    if (processedSet.has(fullPath)) continue; // already handled above

    try {
      const stat = await fsPromises.stat(fullPath);
      if (stat.mtimeMs > cutoffMs) continue; // not old enough

      // Append wontfix marker and move to archive/wontfix/
      const content = await fsPromises.readFile(fullPath, 'utf-8');
      // Skip if already wontfixed
      if (content.includes('wontfix: true')) continue;

      const wontfixDir = join(archiveBaseDir, 'wontfix');
      await fsPromises.mkdir(wontfixDir, { recursive: true });
      const updatedContent = appendWontfix(content);
      const destPath = join(wontfixDir, entry);
      await fsPromises.writeFile(destPath, updatedContent, 'utf-8');
      await fsPromises.unlink(fullPath);
      wontfixed.push(fullPath);
    } catch (err) {
      console.warn(`[retro-archiver] Failed to age out ${entry}:`, err);
      errors.push(fullPath);
    }
  }

  return { archived, wontfixed, errors };
}
