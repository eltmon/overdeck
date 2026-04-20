/**
 * Synthesis core module (PAN-709, bead ncg)
 *
 * Reads all non-archived retros, filters to surprise: true, groups by
 * (target_skill, audience, normalized_gap_description), applies 3-signal
 * threshold. Above-threshold groups become issue proposals; below become
 * watchlist entries.
 *
 * All file I/O uses fs/promises — no sync calls.
 */

import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseRetroMarkdown, type ProposedChange } from './retro-writer.js';

const DEFAULT_RETROS_DIR = join(homedir(), 'docs', 'flywheel', 'retros');

/** Minimum number of retros with the same signature to promote to a proposal. */
const SIGNAL_THRESHOLD = 3;

// ============================================================================
// Types
// ============================================================================

/** Canonical grouping key — stringified for Map use. */
export interface ProposalSignature {
  targetSkill: string;
  audience: string;
  gapDescription: string;
}

export interface IssueProposal {
  signature: ProposalSignature;
  retroCount: number;
  /** Median friction_score across the triggering retros. */
  medianFrictionScore: number;
  /** File paths (relative to retrosDir) of each triggering retro. */
  triggeringRetros: string[];
  /** Change type from the primary triggering proposed_change. */
  proposedType: ProposedChange['type'];
  /**
   * The aggregated change description. For multiple retros with similar
   * proposed changes, this is the first non-empty description encountered.
   */
  aggregatedChange: string;
}

export interface WatchlistEntry {
  signature: ProposalSignature;
  retroCount: number;
  triggeringRetros: string[];
}

export interface SynthesisResult {
  proposals: IssueProposal[];
  watchlist: WatchlistEntry[];
  /** Absolute paths of every retro file that was read (surprise or no-op). */
  processedRetros: string[];
  /**
   * Fraction of retros that had surprise: true.
   * 0.0 = all no-ops, 1.0 = all surprises.
   */
  filterRatio: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a description string for grouping purposes.
 * Lowercases and collapses whitespace.
 */
function normalizeDescription(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Stringify a ProposalSignature for use as a Map key.
 */
function signatureKey(sig: ProposalSignature): string {
  return `${sig.targetSkill}|${sig.audience}|${sig.gapDescription}`;
}

/**
 * Extract the primary groupable signal from a ProposedChange.
 * Returns null for no_op or unrecognized types (should not be grouped).
 */
function extractSignal(change: ProposedChange): {
  targetSkill: string;
  audience: string;
  gapDescription: string;
  changeType: ProposedChange['type'];
  changeDescription: string;
} | null {
  switch (change.type) {
    case 'add_skill':
      return {
        targetSkill: change.name,
        audience: change.audience,
        gapDescription: normalizeDescription(change.purpose),
        changeType: change.type,
        changeDescription: change.purpose,
      };
    case 'update_skill':
      return {
        targetSkill: change.name,
        audience: '',
        gapDescription: normalizeDescription(`${change.section}: ${change.change}`),
        changeType: change.type,
        changeDescription: change.change,
      };
    case 'deprecate_skill':
      return {
        targetSkill: change.name,
        audience: '',
        gapDescription: normalizeDescription(change.reason),
        changeType: change.type,
        changeDescription: change.reason,
      };
    case 'file_substrate_issue':
      return {
        targetSkill: change.title,
        audience: '',
        gapDescription: normalizeDescription(change.reason),
        changeType: change.type,
        changeDescription: change.reason,
      };
    case 'no_op':
      return null;
    default:
      return null;
  }
}

/**
 * Compute the median of an array of numbers.
 * Returns 0 for an empty array.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ============================================================================
// File reading
// ============================================================================

/**
 * Read all .md files in retrosDir that are NOT inside archive/.
 * Returns an array of { path, content } objects.
 */
async function readNonArchivedRetros(
  retrosDir: string,
): Promise<Array<{ path: string; content: string }>> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir(retrosDir);
  } catch {
    // retrosDir doesn't exist yet — no retros
    return [];
  }

  const results: Array<{ path: string; content: string }> = [];
  for (const entry of entries) {
    // Skip the archive directory
    if (entry === 'archive') continue;

    const fullPath = join(retrosDir, entry);
    let stat;
    try {
      stat = await fsPromises.stat(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) continue;
    if (!entry.endsWith('.md')) continue;

    try {
      const content = await fsPromises.readFile(fullPath, 'utf-8');
      results.push({ path: fullPath, content });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

// ============================================================================
// Core synthesis
// ============================================================================

interface RetroSignalAccumulator {
  signature: ProposalSignature;
  changeType: ProposedChange['type'];
  changeDescription: string;
  frictionScores: number[];
  retroPaths: string[];
  seenPaths: Set<string>;
}

/**
 * Run the synthesis pipeline over all non-archived retros.
 *
 * Steps:
 * 1. Read all .md files in retrosDir (excluding archive/)
 * 2. Parse + filter to surprise: true retros
 * 3. Group each proposed_change by (targetSkill, audience, gapDescription)
 * 4. Apply 3-signal threshold → proposals vs watchlist
 *
 * @param retrosDir - Override for the retros directory (default: ~/docs/flywheel/retros/)
 */
export async function runSynthesis(retrosDir: string = DEFAULT_RETROS_DIR): Promise<SynthesisResult> {
  const files = await readNonArchivedRetros(retrosDir);

  const processedRetros: string[] = [];
  let surpriseCount = 0;

  // Map from signature key → accumulator
  const accumulators = new Map<string, RetroSignalAccumulator>();

  for (const { path, content } of files) {
    processedRetros.push(path);

    const doc = parseRetroMarkdown(content);
    if (!doc) continue;

    if (!doc.frontmatter.surprise) continue;

    surpriseCount++;
    const frictionScore = doc.frontmatter.friction_score ?? 0;
    const proposedChanges = doc.frontmatter.proposed_changes ?? [];

    for (const change of proposedChanges) {
      const signal = extractSignal(change);
      if (!signal) continue; // skip no_op

      const sig: ProposalSignature = {
        targetSkill: signal.targetSkill,
        audience: signal.audience,
        gapDescription: signal.gapDescription,
      };
      const key = signatureKey(sig);

      if (!accumulators.has(key)) {
        accumulators.set(key, {
          signature: sig,
          changeType: signal.changeType,
          changeDescription: signal.changeDescription,
          frictionScores: [],
          retroPaths: [],
          seenPaths: new Set(),
        });
      }

      const acc = accumulators.get(key)!;
      acc.frictionScores.push(frictionScore);
      if (!acc.seenPaths.has(path)) {
        acc.seenPaths.add(path);
        acc.retroPaths.push(path);
      }
    }
  }

  // Apply threshold
  const proposals: IssueProposal[] = [];
  const watchlist: WatchlistEntry[] = [];

  for (const acc of accumulators.values()) {
    const retroCount = acc.retroPaths.length;
    if (retroCount >= SIGNAL_THRESHOLD) {
      proposals.push({
        signature: acc.signature,
        retroCount,
        medianFrictionScore: median(acc.frictionScores),
        triggeringRetros: acc.retroPaths,
        proposedType: acc.changeType,
        aggregatedChange: acc.changeDescription,
      });
    } else {
      watchlist.push({
        signature: acc.signature,
        retroCount,
        triggeringRetros: acc.retroPaths,
      });
    }
  }

  // Sort proposals by median friction score descending (worst pain first)
  proposals.sort((a, b) => b.medianFrictionScore - a.medianFrictionScore);

  const filterRatio = processedRetros.length === 0
    ? 0
    : surpriseCount / processedRetros.length;

  return { proposals, watchlist, processedRetros, filterRatio };
}
