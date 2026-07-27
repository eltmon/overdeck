/**
 * Review findings parsing and analysis.
 * Shared utilities for extracting and counting blocking findings from report and synthesis formats.
 */

export interface ReviewCycleEntry {
  cycle: number;
  runId: string;
  atCommit?: string;
  blockingCount: number;
  recordedAt: string;
}

/**
 * Extract a markdown section by heading.
 * Returns the content between a heading (e.g., "## Findings") and the next heading or EOF.
 */
export function extractMarkdownSection(markdown: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${heading}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'im');
  return markdown.match(pattern)?.[1]?.trim() ?? '';
}

/**
 * Find blocking findings in a report markdown section.
 * Returns titles of findings marked with '!' or '⊗'.
 */
export function findBlockingFindings(markdown: string): string[] {
  const findings = extractMarkdownSection(markdown, 'Findings');
  if (!findings || /^none\.?$/i.test(findings)) return [];

  const blockers: string[] = [];
  const headingPattern = /^###\s*(?:!|⊗)\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(findings)) !== null) {
    blockers.push(match[1]!.trim());
  }
  return blockers;
}

/**
 * Count blocking findings in a synthesis body.
 * Returns the count of '## Blocking Findings' section headings (### markers),
 * or 0 if the section is absent, empty, or contains only 'None'.
 */
export function countSynthesisBlockingFindings(body: string): number {
  const findings = extractMarkdownSection(body, 'Blocking Findings');
  if (!findings || /^none\.?$/i.test(findings)) return 0;

  const headingPattern = /^###\s+/gm;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(findings)) !== null) {
    count++;
  }
  return count;
}
