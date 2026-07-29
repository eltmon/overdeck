import { randomUUID } from 'crypto';
import { Effect } from 'effect';

import type { FsError } from '../errors.js';
import { writeSpecForIssue } from '../pan-dir/specs.js';
import { generateXBriefFilename } from './lifecycle.js';
import type { XBriefDocument, XBriefSubItem } from './types.js';

export interface AutoSynthesizeIssueInput {
  issueId: string;
  title: string;
  body?: string | null;
  url?: string | null;
}

export interface AutoSynthesizeResult {
  document: XBriefDocument;
  workspaceSpecPath: string;
  projectSpecPath: string;
  canonicalFilename: string;
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^#+\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

export function extractAcceptanceCriteriaFromIssue(title: string, body?: string | null): string[] {
  const text = body?.trim() ?? '';
  if (!text) return [`Implement ${title}`];

  const lines = text.split(/\r?\n/);
  // Only a real heading (or standalone bold/label line) counts — the phrase
  // appearing mid-prose must not start a section (PAN-2404).
  const headingIndex = lines.findIndex((line) =>
    /^#{1,6}\s+.*acceptance(\s+criteria)?\b/i.test(line)
    || /^\s*\*{0,2}acceptance criteria\*{0,2}:?\s*$/i.test(line));

  // If an explicit Acceptance Criteria section exists, use only that section
  if (headingIndex >= 0) {
    // Find the end of this section (next heading or end of text)
    const sectionEndIndex = lines.findIndex((line, idx) =>
      idx > headingIndex && /^#+\s+/.test(line)
    );
    const endIndex = sectionEndIndex >= 0 ? sectionEndIndex : lines.length;
    const sectionLines = lines.slice(headingIndex + 1, endIndex);

    const checklist = sectionLines
      .filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line))
      .map(cleanMarkdownLine)
      .filter(Boolean);
    if (checklist.length > 0) return checklist;

    const bullets = sectionLines
      .filter((line) => /^\s*[-*+]\s+/.test(line))
      .map(cleanMarkdownLine)
      .filter(Boolean)
      .slice(0, 8);
    if (bullets.length > 0) return bullets;
  }

  // No explicit Acceptance Criteria section: return a single generic AC
  return [`Issue's stated fix implemented with tests`];
}

export function synthesizeMinimalXBrief(issue: AutoSynthesizeIssueInput): XBriefDocument {
  const issueId = issue.issueId.toUpperCase();
  const issueLabel = issueId.toLowerCase();
  const now = new Date().toISOString();
  const criteria = extractAcceptanceCriteriaFromIssue(issue.title, issue.body);
  const items: XBriefSubItem[] = criteria.map((criterion, index) => ({
    id: `auto-start.ac${index + 1}`,
    title: criterion,
    status: 'pending',
    created: now,
    metadata: { kind: 'acceptance_criterion' },
  }));

  const canonicalFilename = generateXBriefFilename(issueId, issue.title, now);

  return {
    xBRIEFInfo: {
      version: '0.8',
      created: now,
      updated: now,
      author: 'overdeck/auto-start',
      description: `Auto-synthesized minimal plan for ${issueId}: ${issue.title}`,
      inspectionPolicy: 'never',
    },
    plan: {
      id: issueLabel,
      title: issue.title,
      status: 'proposed',
      uid: randomUUID(),
      author: 'overdeck/auto-start',
      sequence: 1,
      created: now,
      updated: now,
      references: issue.url ? [{ uri: issue.url, label: issueId, type: 'issue' }] : [],
      tags: ['auto-start'],
      metadata: { canonicalFilename },
      narratives: {
        Problem: issue.body?.trim() || issue.title,
        Proposal: 'Implement the issue directly from the tracker-provided title and body.',
      },
      items: [
        {
          id: 'auto-start',
          title: 'Implement issue',
          status: 'pending',
          priority: 'medium',
          created: now,
          metadata: {
            difficulty: 'simple',
            issueLabel,
            requiresInspection: false,
            inspectionDepth: 'fast',
          },
          narrative: { Action: issue.body?.trim() || issue.title },
          items,
        },
      ],
      edges: [],
    },
  };
}

/**
 * Synthesize and durably persist a proposed spec through the canonical write
 * door. The returned workspace path is the canonical spec path because
 * workspace-local spec copies are migration compatibility only.
 */
export const writeAutoStartXBrief = (
  projectRoot: string,
  _workspacePath: string,
  issue: AutoSynthesizeIssueInput,
): Effect.Effect<AutoSynthesizeResult, FsError> =>
  Effect.gen(function* () {
    const document = synthesizeMinimalXBrief(issue);
    const canonicalFilename = document.plan.metadata?.canonicalFilename as string;
    const projectDocument: XBriefDocument = {
      ...document,
      plan: { ...document.plan, status: 'proposed' },
    };
    const written = yield* writeSpecForIssue(
      projectRoot,
      projectDocument,
      'proposed',
      canonicalFilename,
    );

    return {
      document,
      workspaceSpecPath: written.path,
      projectSpecPath: written.path,
      canonicalFilename,
    };
  });
