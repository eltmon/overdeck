import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';

import { getWorkspacePanPaths } from '../pan-dir/index.js';
import { generateVBriefFilename } from './lifecycle.js';
import type { VBriefDocument, VBriefSubItem } from './types.js';

export interface AutoSynthesizeIssueInput {
  issueId: string;
  title: string;
  body?: string | null;
  url?: string | null;
}

export interface AutoSynthesizeResult {
  document: VBriefDocument;
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
  const headingIndex = lines.findIndex((line) => /acceptance criteria/i.test(line));
  const candidateLines = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines;
  const checklist = candidateLines
    .filter((line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line))
    .map(cleanMarkdownLine)
    .filter(Boolean);
  if (checklist.length > 0) return checklist;

  const bullets = candidateLines
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .slice(0, 8);
  if (bullets.length > 0) return bullets;

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith('#'))
    .slice(0, 3);
  return paragraphs.length > 0 ? paragraphs : [`Implement ${title}`];
}

export function synthesizeMinimalVBrief(issue: AutoSynthesizeIssueInput): VBriefDocument {
  const issueId = issue.issueId.toUpperCase();
  const issueLabel = issueId.toLowerCase();
  const now = new Date().toISOString();
  const criteria = extractAcceptanceCriteriaFromIssue(issue.title, issue.body);
  const subItems: VBriefSubItem[] = criteria.map((criterion, index) => ({
    id: `auto-start.ac${index + 1}`,
    title: criterion,
    status: 'pending',
    created: now,
    metadata: { kind: 'acceptance_criterion' },
  }));

  const canonicalFilename = generateVBriefFilename(issueId, issue.title, now);

  return {
    vBRIEFInfo: {
      version: '0.5',
      created: now,
      updated: now,
      author: 'panopticon-cli/auto-start',
      description: `Auto-synthesized minimal plan for ${issueId}: ${issue.title}`,
      inspectionPolicy: 'never',
    },
    plan: {
      id: issueLabel,
      title: issue.title,
      status: 'proposed',
      uid: randomUUID(),
      author: 'panopticon-cli/auto-start',
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
          subItems,
        },
      ],
      edges: [],
    },
  };
}

export async function writeAutoStartVBrief(
  projectRoot: string,
  workspacePath: string,
  issue: AutoSynthesizeIssueInput,
): Promise<AutoSynthesizeResult> {
  const document = synthesizeMinimalVBrief(issue);
  const canonicalFilename = document.plan.metadata?.canonicalFilename as string;
  const workspacePaths = getWorkspacePanPaths(workspacePath);

  const projectSpecsDir = join(projectRoot, '.pan', 'specs');
  const projectSpecPath = join(projectSpecsDir, canonicalFilename);
  const projectDocument: VBriefDocument = {
    ...document,
    plan: { ...document.plan, status: 'proposed' },
  };

  await mkdir(workspacePaths.panDir, { recursive: true });
  await mkdir(projectSpecsDir, { recursive: true });
  await writeFile(workspacePaths.specPath, JSON.stringify(document, null, 2), 'utf-8');
  await writeFile(projectSpecPath, JSON.stringify(projectDocument, null, 2), 'utf-8');

  return {
    document,
    workspaceSpecPath: workspacePaths.specPath,
    projectSpecPath,
    canonicalFilename,
  };
}
