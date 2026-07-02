/**
 * PAN-1791 tiered execution — standing supervisor: verdict surface.
 *
 * This module carries the supervisor-verdict-surface slice (FR-4): for each
 * subscribed commit, compose a review request containing the commit diff plus
 * the bead's acceptance criteria (and the PRD's traced FR text when the item
 * carries metadata.traces), deliver it to the standing supervisor via the
 * existing deliverAgentMessage primitive (FR-7, no new transport), and
 * instruct the supervisor to land its ack or blocking finding on the EXISTING
 * inspect-status surface (POST /api/specialists/done with specialist
 * "inspect") so the foreman's wait-for-verdict path is reused unchanged:
 * a pass persists inspectStatus + saves the checkpoint via onInspectComplete,
 * a failure records a blocking finding and never changes tracker status.
 *
 * Sibling slice note: supervisor spawn + subscription policy
 * (shouldSupervise, item supervisor-subscribe) is owned by a separate bead
 * and lands alongside this module.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { VBriefItem, VBriefSubItem } from '../vbrief/types.js';
import { deliverAgentMessage } from './delivery.js';
import type { DeliveryResult } from './delivery.js';

const execFileAsync = promisify(execFile);

/** One commit-review event as delivered to the standing supervisor. */
export interface SupervisorReviewEvent {
  issueId: string;
  /** Beads-tracker id the verdict must reference ("Bead <beadId> ..."). */
  beadId: string;
  beadTitle: string;
  /** Full commit sha being reviewed. */
  sha: string;
  /** Output of `git show <sha>` for the commit. */
  diff: string;
  /** The bead's acceptance-criterion titles, in plan order. */
  acceptanceCriteria: string[];
  /** Traced PRD FR text, present when the item carries metadata.traces. */
  frText?: string;
  /** Dashboard base URL the verdict POST targets. */
  apiUrl: string;
}

export interface DeliverCommitForReviewOptions {
  /** Agent id of the standing supervisor session. */
  supervisorAgentId: string;
  /** Workspace the commit lives in (git worktree on the feature branch). */
  workspacePath: string;
  issueId: string;
  /** The vBRIEF item the commit implements. */
  item: VBriefItem;
  sha: string;
  /** Beads id for the verdict prefix; defaults to the vBRIEF item id. */
  beadId?: string;
  /**
   * PRD draft markdown to source traced FR text from. When omitted and the
   * item has metadata.traces, callers should pass the result of
   * loadPrdDraft(projectRoot, issueId).
   */
  prdMarkdown?: string;
  apiUrl?: string;
  /** Test seams — default to the real primitives. */
  deps?: {
    deliver?: typeof deliverAgentMessage;
    getDiff?: (workspacePath: string, sha: string) => Promise<string>;
  };
}

function resolveApiUrl(): string {
  return (
    process.env.OVERDECK_DASHBOARD_URL
    || process.env.DASHBOARD_URL
    || `http://localhost:${process.env.API_PORT || process.env.PORT || '3011'}`
  );
}

function childItems(item: VBriefItem): VBriefSubItem[] {
  // vBRIEF v0.6 uses `items`; v0.5 documents used `subItems` for the same
  // structure and are still read as a compatibility alias.
  return item.items ?? item.subItems ?? [];
}

/**
 * Pull the bead's acceptance-criterion titles from its vBRIEF child items
 * (child metadata.kind === 'acceptance_criterion').
 */
export function extractAcceptanceCriteria(item: VBriefItem): string[] {
  return childItems(item)
    .filter((child) => child.metadata?.kind === 'acceptance_criterion')
    .map((child) => child.title);
}

/**
 * Extract the PRD requirement text for the given trace ids (e.g. ["FR-4"]).
 *
 * PRD requirement bullets follow the prd-authoring convention:
 *   - **FR-4 — Title.** Body text...
 * Each matched requirement is captured from its bullet line through any
 * indented continuation lines, up to the next bullet or heading. Returns
 * undefined when no trace resolves to a requirement in the document.
 */
export function extractTracedFrText(prdMarkdown: string, traces: readonly string[]): string | undefined {
  if (traces.length === 0) return undefined;
  const lines = prdMarkdown.split('\n');
  const sections: string[] = [];

  for (const trace of traces) {
    const startPattern = new RegExp(`^\\s*[-*]\\s+\\*\\*${trace}\\b`);
    const start = lines.findIndex((line) => startPattern.test(line));
    if (start === -1) continue;

    const captured = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      // A new bullet, a heading, or a blank line ends the requirement body.
      if (/^\s*[-*]\s/.test(line) || /^#/.test(line) || line.trim() === '') break;
      captured.push(line);
    }
    sections.push(captured.join('\n'));
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

/**
 * Read the Overdeck-managed PRD draft for an issue
 * (<projectRoot>/.pan/drafts/<ISSUE>.md, falling back to the lowercase
 * filename). Returns undefined when no draft exists.
 */
export async function loadPrdDraft(projectRoot: string, issueId: string): Promise<string | undefined> {
  for (const name of [`${issueId.toUpperCase()}.md`, `${issueId.toLowerCase()}.md`]) {
    try {
      return await readFile(join(projectRoot, '.pan', 'drafts', name), 'utf-8');
    } catch {
      // Try the next casing; missing drafts are expected.
    }
  }
  return undefined;
}

/**
 * Compose the per-commit review request delivered to the standing supervisor.
 *
 * Unlike commit-feed messages this is NOT ingestion-only: the supervisor must
 * respond by posting exactly one verdict to the existing inspect surface.
 */
export function buildSupervisorReviewMessage(event: SupervisorReviewEvent): string {
  const shortSha = event.sha.slice(0, 8);
  const criteria = event.acceptanceCriteria.length > 0
    ? event.acceptanceCriteria.map((ac, i) => `${i + 1}. ${ac}`).join('\n')
    : '(none recorded on the plan item — review against the bead title)';

  const frSection = event.frText
    ? `\n## Traced requirements (PRD)\n\n${event.frText}\n`
    : '';

  return `SUPERVISOR REVIEW REQUEST — commit ${shortSha} on ${event.issueId}

You are the standing supervisor for ${event.issueId}. Review this commit against the bead's acceptance criteria and respond with a verdict. You never implement — do not edit files, commit, or run write operations.

## Bead under review

- Issue: ${event.issueId}
- Bead: ${event.beadId} — ${event.beadTitle}
- Commit: ${event.sha}

## Acceptance criteria

${criteria}
${frSection}
## Commit diff (git show ${shortSha})

\`\`\`diff
${event.diff}
\`\`\`

## Verdict (REQUIRED — post exactly one)

Land your verdict on the existing inspect-status surface. Your notes MUST begin with "Bead ${event.beadId}" — the server extracts the bead id from that prefix.

If the diff satisfies the acceptance criteria, post an ack (this persists inspectStatus and saves the bead checkpoint):

\`\`\`bash
curl -X POST ${event.apiUrl}/api/specialists/done \\
  -H "Content-Type: application/json" \\
  -d '{"specialist":"inspect","issueId":"${event.issueId}","status":"passed","notes":"Bead ${event.beadId} ack: <one-line summary>"}'
\`\`\`

If any acceptance criterion is not met, post a blocking finding with specific, actionable violations ([file:line] + what is wrong):

\`\`\`bash
curl -X POST ${event.apiUrl}/api/specialists/done \\
  -H "Content-Type: application/json" \\
  -d '{"specialist":"inspect","issueId":"${event.issueId}","status":"failed","notes":"Bead ${event.beadId} BLOCKED: <specific violations and required fixes>"}'
\`\`\`

Rules:
- A blocking finding is recorded on the inspect-status surface only — it does NOT change tracker (Linear/GitHub) status. Never run \`gh issue close\` or edit tracker state.
- Do not use any other endpoint or side channel for the verdict.
- Only review this commit against this bead's acceptance criteria — compile, lint, and tests are the verification gate's job, and code style is the review convoy's job.`;
}

async function getCommitDiff(workspacePath: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', sha], {
    cwd: workspacePath,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Deliver one subscribed commit to the standing supervisor for review:
 * resolve the diff, pull the bead's acceptance criteria from its vBRIEF item
 * (plus traced FR text when metadata.traces is present and a PRD draft was
 * provided), and send the composed review request via deliverAgentMessage.
 */
export async function deliverCommitForReview(options: DeliverCommitForReviewOptions): Promise<DeliveryResult> {
  const deliver = options.deps?.deliver ?? deliverAgentMessage;
  const getDiff = options.deps?.getDiff ?? getCommitDiff;

  const diff = await getDiff(options.workspacePath, options.sha);
  const traces = Array.isArray(options.item.metadata?.traces)
    ? (options.item.metadata.traces as string[])
    : [];
  const frText = options.prdMarkdown && traces.length > 0
    ? extractTracedFrText(options.prdMarkdown, traces)
    : undefined;

  const message = buildSupervisorReviewMessage({
    issueId: options.issueId,
    beadId: options.beadId ?? options.item.id,
    beadTitle: options.item.title,
    sha: options.sha,
    diff,
    acceptanceCriteria: extractAcceptanceCriteria(options.item),
    frText,
    apiUrl: options.apiUrl ?? resolveApiUrl(),
  });

  return deliver(options.supervisorAgentId, message, 'tier-supervisor:verdict');
}
