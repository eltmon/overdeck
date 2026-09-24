import { existsSync } from 'node:fs';
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
