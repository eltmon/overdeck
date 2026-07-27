import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

export const VERDICT_REPORT_FILENAMES = ['synthesis.md', 'review.md'] as const;

export type VerdictReportFilename = (typeof VERDICT_REPORT_FILENAMES)[number];
export type ReviewVerdict = 'passed' | 'blocked' | 'failed';

export interface VerdictReport {
  path: string;
  filename: VerdictReportFilename;
}

export interface ParsedVerdictReport {
  verdict: ReviewVerdict;
  topBlocker: string;
}

export function findVerdictReport(dirPath: string): VerdictReport | null {
  for (const filename of VERDICT_REPORT_FILENAMES) {
    const path = join(dirPath, filename);
    if (existsSync(path)) return { path, filename };
  }
  return null;
}

export async function findVerdictReportAsync(dirPath: string): Promise<VerdictReport | null> {
  for (const filename of VERDICT_REPORT_FILENAMES) {
    const path = join(dirPath, filename);
    try {
      await access(path);
      return { path, filename };
    } catch {
      // Try the next supported artifact name.
    }
  }
  return null;
}

export function parseVerdictReport(content: string): ParsedVerdictReport | null {
  const verdictLine = content.match(/^##\s*Verdict:\s*(.+)$/im);
  if (!verdictLine) return null;

  const verdictText = verdictLine[1]!.trim();
  if (/^(?:APPROVED|PASSED)\b/i.test(verdictText)) {
    return { verdict: 'passed', topBlocker: '' };
  }
  if (/^FAILED\b/i.test(verdictText)) {
    return { verdict: 'failed', topBlocker: '' };
  }

  const changesRequested = verdictText.match(/^CHANGES REQUESTED(?:\s*(?:—|–|:|-)\s*(.+))?$/i);
  if (!changesRequested) return null;

  const suffixBlocker = changesRequested[1]?.trim();
  if (suffixBlocker) {
    return { verdict: 'blocked', topBlocker: suffixBlocker };
  }

  const blockingHeading = content.match(/^##\s*Blocking Findings\s*$/im);
  let blockingSection = '';
  if (blockingHeading?.index !== undefined) {
    const sectionStart = blockingHeading.index + blockingHeading[0].length;
    const remainingContent = content.slice(sectionStart);
    const nextSectionIndex = remainingContent.search(/^##\s/m);
    blockingSection = nextSectionIndex === -1
      ? remainingContent
      : remainingContent.slice(0, nextSectionIndex);
  }
  const sectionBlocker = blockingSection.match(/^###\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { verdict: 'blocked', topBlocker: sectionBlocker };
}
