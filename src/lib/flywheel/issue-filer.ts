/**
 * Synthesis issue filer (PAN-709, bead aq8)
 *
 * For each above-threshold proposal from runSynthesis(), files one GitHub
 * issue in the Panopticon repo with the flywheel-change label.
 *
 * Cap: at most 10 issues per run (sorted by median friction score).
 * Overflow is returned as deferred — rolls to the next cycle.
 *
 * Uses the existing tracker client to inherit retry/auth behavior.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { createTracker } from '../tracker/factory.js';
import type { IssueProposal } from './synthesis.js';

// ============================================================================
// Provenance index — maps GitHub issue number → triggering retro filenames
// ============================================================================

export const PROVENANCE_INDEX_PATH = join(homedir(), 'docs', 'flywheel', 'provenance-index.json');

export type ProvenanceIndex = Record<string, string[]>;

export async function readProvenanceIndex(): Promise<ProvenanceIndex> {
  try {
    const raw = await readFile(PROVENANCE_INDEX_PATH, 'utf-8');
    return JSON.parse(raw) as ProvenanceIndex;
  } catch {
    return {};
  }
}

export async function writeProvenanceIndex(
  entries: Array<{ issueUrl: string; retroFilenames: string[] }>,
): Promise<void> {
  const existing = await readProvenanceIndex();
  for (const { issueUrl, retroFilenames } of entries) {
    const num = issueUrl.split('/').pop() ?? '';
    if (num) existing[num] = retroFilenames;
  }
  await mkdir(dirname(PROVENANCE_INDEX_PATH), { recursive: true });
  await writeFile(PROVENANCE_INDEX_PATH, JSON.stringify(existing, null, 2), 'utf-8');
}

const MAX_ISSUES_PER_RUN = 10;

const VERB_MAP: Record<string, string> = {
  add_skill: 'add',
  update_skill: 'update',
  deprecate_skill: 'deprecate',
  file_substrate_issue: 'substrate',
};

// ============================================================================
// Types
// ============================================================================

export interface FiledIssue {
  proposalSignature: string;
  /** Visible GitHub issue number (from URL), NOT the internal GitHub node id. */
  issueNumber: number;
  issueUrl: string;
  title: string;
  /** Basenames of the retro files that triggered this flywheel-change issue. */
  triggeringRetros: string[];
}

export interface IssueFilingResult {
  filed: FiledIssue[];
  /** Proposals that were NOT filed this run (count exceeded MAX_ISSUES_PER_RUN). */
  deferred: IssueProposal[];
  /** Proposals that failed to file (error is logged, filing continues). */
  errors: Array<{ proposal: IssueProposal; error: string }>;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatIssueTitle(proposal: IssueProposal): string {
  const verb = VERB_MAP[proposal.proposedType] ?? proposal.proposedType;
  const skill = proposal.signature.targetSkill;
  // Truncate the gap description to keep titles short
  const summary = proposal.signature.gapDescription.slice(0, 60);
  return `flywheel: ${verb} ${skill} — ${summary}`;
}

function formatIssueBody(proposal: IssueProposal): string {
  const lines: string[] = [];

  lines.push('## Flywheel synthesis proposal');
  lines.push('');
  lines.push(`**Signal count:** ${proposal.retroCount}`);
  lines.push(`**Median friction score:** ${proposal.medianFrictionScore.toFixed(1)}/10`);
  lines.push(`**Proposed change type:** \`${proposal.proposedType}\``);
  if (proposal.signature.audience) {
    lines.push(`**Audience:** \`${proposal.signature.audience}\``);
  }
  lines.push('');

  lines.push('## Triggering retros');
  lines.push('');
  for (const retroPath of proposal.triggeringRetros) {
    // Show the filename portion for readability
    const filename = basename(retroPath);
    lines.push(`- \`${filename}\``);
  }
  lines.push('');

  lines.push('## Proposed SKILL.md patch');
  lines.push('');
  lines.push('```yaml');
  if (proposal.proposedType === 'add_skill') {
    lines.push(`name: ${proposal.signature.targetSkill}`);
    if (proposal.signature.audience) {
      lines.push(`audience: ${proposal.signature.audience}`);
    }
    lines.push(`description: ${proposal.aggregatedChange}`);
  } else if (proposal.proposedType === 'update_skill') {
    lines.push(`skill: ${proposal.signature.targetSkill}`);
    lines.push(`change: ${proposal.aggregatedChange}`);
  } else if (proposal.proposedType === 'deprecate_skill') {
    lines.push(`skill: ${proposal.signature.targetSkill}`);
    lines.push(`action: deprecate`);
    lines.push(`reason: ${proposal.aggregatedChange}`);
  } else {
    lines.push(`title: ${proposal.signature.targetSkill}`);
    lines.push(`reason: ${proposal.aggregatedChange}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('_Auto-generated by flywheel synthesis. Review and amend before merging._');

  return lines.join('\n');
}

// ============================================================================
// Core filer
// ============================================================================

export interface IssueFilingOptions {
  /** Override the owner/repo (default: eltmon/panopticon-cli). */
  owner?: string;
  repo?: string;
}

/**
 * File GitHub issues for each above-threshold proposal.
 * Proposals MUST be pre-sorted by priority (highest first) — only the first
 * MAX_ISSUES_PER_RUN are filed; the rest are returned as deferred.
 *
 * @param proposals - From runSynthesis(), already sorted by medianFrictionScore desc
 * @param options - Override owner/repo for testing
 */
export async function fileFlywheelIssues(
  proposals: IssueProposal[],
  options: IssueFilingOptions = {},
): Promise<IssueFilingResult> {
  const owner = options.owner ?? 'eltmon';
  const repo = options.repo ?? 'panopticon-cli';

  const toFile = proposals.slice(0, MAX_ISSUES_PER_RUN);
  const deferred = proposals.slice(MAX_ISSUES_PER_RUN);

  const tracker = createTracker({ type: 'github', owner, repo });

  const filed: FiledIssue[] = [];
  const errors: Array<{ proposal: IssueProposal; error: string }> = [];

  for (const proposal of toFile) {
    const title = formatIssueTitle(proposal);
    const description = formatIssueBody(proposal);
    const signatureStr = `${proposal.signature.targetSkill}|${proposal.signature.audience}|${proposal.signature.gapDescription}`;

    try {
      const issue = await tracker.createIssue({
        title,
        description,
        labels: ['flywheel-change'],
      });

      filed.push({
        proposalSignature: signatureStr,
        // Parse the visible issue number from the URL — issue.id is GitHub's
        // internal node id, which differs from the user-visible issue number.
        issueNumber: parseInt(issue.url.split('/').pop() ?? '', 10) || 0,
        issueUrl: issue.url,
        title,
        triggeringRetros: proposal.triggeringRetros.map((p) => basename(p)),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[issue-filer] Failed to file issue for "${title}": ${message}`);
      errors.push({ proposal, error: message });
    }
  }

  if (deferred.length > 0) {
    console.log(`[issue-filer] Deferred ${deferred.length} proposals (cap: ${MAX_ISSUES_PER_RUN}/run)`);
  }

  return { filed, deferred, errors };
}
