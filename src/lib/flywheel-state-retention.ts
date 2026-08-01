import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FLYWHEEL_STATE_MAX_BYTES = 120 * 1024;
export const FLYWHEEL_STATE_MAX_LINES = 1_000;
export const FLYWHEEL_STATE_VERBATIM_RUNS = 3;

interface MarkdownBlock {
  heading: string;
  text: string;
  runNumber: number | null;
}

export interface FlywheelStateCompactionResult {
  content: string;
  compactedRunNumbers: number[];
  preservedRunNumbers: number[];
  changed: boolean;
}

export interface FlywheelStateFileCompactionResult {
  compacted: boolean;
  compactedRunNumbers: number[];
  preservedRunNumbers: number[];
}

function parseBlocks(content: string): { preamble: string; blocks: MarkdownBlock[] } {
  const matches = [...content.matchAll(/^## .+$/gm)];
  if (matches.length === 0) return { preamble: content, blocks: [] };

  const firstIndex = matches[0].index ?? 0;
  return {
    preamble: content.slice(0, firstIndex),
    blocks: matches.map((match, index) => {
      const start = match.index ?? 0;
      const end = matches[index + 1]?.index ?? content.length;
      const runMatch = match[0].match(/^## RUN-(\d+)\b/i);
      const isCompactedSummary = /^## RUN-\d+\s*…/i.test(match[0]) || /compacted summary/i.test(match[0]);
      return {
        heading: match[0],
        text: content.slice(start, end),
        runNumber: runMatch && !isCompactedSummary ? Number(runMatch[1]) : null,
      };
    }),
  };
}

function normalizeOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function tickNumber(heading: string): number {
  const match = heading.match(/\bticks?\s+(\d+)/i);
  return match ? Number(match[1]) : -1;
}

function summarizeRun(runNumber: number, blocks: MarkdownBlock[]): string {
  const selected = blocks.reduce((latest, candidate) => (
    tickNumber(candidate.heading) >= tickNumber(latest.heading) ? candidate : latest
  ));
  const dates = blocks.flatMap((block) => block.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []).sort();
  const date = dates.at(-1);
  const dashIndex = selected.heading.indexOf('—');
  const rawSummary = dashIndex >= 0
    ? selected.heading.slice(dashIndex + 1)
    : selected.heading.replace(new RegExp(`^## RUN-${runNumber}\\b`, 'i'), '');
  const summary = truncate(normalizeOneLine(rawSummary) || 'run completed', 220);
  const issueIds: string[] = [];
  const seen = new Set<string>();
  for (const text of [selected.text, ...blocks.map((block) => block.text)]) {
    for (const match of text.matchAll(/\bPAN-\d+\b/g)) {
      if (seen.has(match[0])) continue;
      seen.add(match[0]);
      issueIds.push(match[0]);
      if (issueIds.length === 8) break;
    }
    if (issueIds.length === 8) break;
  }
  const issues = issueIds.length > 0 ? `; key issues: ${issueIds.join(', ')}` : '';
  return `- **RUN-${runNumber}${date ? ` (${date})` : ''}** — ${summary}${issues}`;
}

function readExistingSummaries(block: MarkdownBlock | undefined): Map<number, string> {
  const summaries = new Map<number, string>();
  if (!block) return summaries;

  const lines = block.text.split('\n');
  let current: string[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const summary = normalizeOneLine(current.join(' '));
    const match = summary.match(/^- \*\*RUN-(\d+)\b/);
    if (match) summaries.set(Number(match[1]), summary);
    current = [];
  };

  for (const line of lines) {
    if (/^- \*\*RUN-\d+\b/.test(line)) {
      flush();
      current.push(line);
    } else if (current.length > 0) {
      if (line.startsWith('  ') || line.trim() === '') current.push(line);
      else flush();
    }
  }
  flush();
  return summaries;
}

function buildCompactedLog(summaries: Map<number, string>): string {
  const runLines = [...summaries.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, summary]) => summary);
  return [
    '## Compacted run log (older than the latest 3 runs)',
    '',
    'One terse line per older run. The original tick-by-tick detail remains available in git history',
    '(`git log --follow docs/FLYWHEEL-STATE.md`); compaction never deletes repository history.',
    '',
    ...runLines,
    '',
    '',
  ].join('\n');
}

export function shouldCompactFlywheelState(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') > FLYWHEEL_STATE_MAX_BYTES
    || content.split('\n').length > FLYWHEEL_STATE_MAX_LINES;
}

export function compactFlywheelState(content: string): FlywheelStateCompactionResult {
  if (!shouldCompactFlywheelState(content)) {
    return { content, compactedRunNumbers: [], preservedRunNumbers: [], changed: false };
  }

  const { preamble, blocks } = parseBlocks(content);
  const detailedRunNumbers = [...new Set(
    blocks.flatMap((block) => block.runNumber === null ? [] : [block.runNumber]),
  )].sort((left, right) => left - right);
  const preservedRunNumbers = detailedRunNumbers.slice(-FLYWHEEL_STATE_VERBATIM_RUNS);
  const preserved = new Set(preservedRunNumbers);
  const compactedRunNumbers = detailedRunNumbers.filter((runNumber) => !preserved.has(runNumber));
  if (compactedRunNumbers.length === 0) {
    return { content, compactedRunNumbers: [], preservedRunNumbers, changed: false };
  }

  const compactionBlocks = blocks.filter((block) => block.heading.startsWith('## Compacted run log'));
  const compactionBlock = compactionBlocks[0];
  const summaries = new Map<number, string>();
  for (const block of compactionBlocks) {
    for (const [runNumber, summary] of readExistingSummaries(block)) summaries.set(runNumber, summary);
  }
  for (const runNumber of compactedRunNumbers) {
    const runBlocks = blocks.filter((block) => block.runNumber === runNumber);
    summaries.set(runNumber, summarizeRun(runNumber, runBlocks));
  }
  for (const runNumber of preservedRunNumbers) summaries.delete(runNumber);
  const compactedLog = buildCompactedLog(summaries);

  const output: string[] = [preamble];
  let insertedCompactedLog = false;
  const insertionBlock = blocks.find((block) => block.heading.startsWith('## Recent runs'))
    ?? blocks.find((block) => block.runNumber !== null);
  for (const block of blocks) {
    if (compactionBlocks.includes(block)) {
      if (block === compactionBlock) {
        output.push(compactedLog);
        insertedCompactedLog = true;
      }
      continue;
    }
    if (!insertedCompactedLog && !compactionBlock && block === insertionBlock) {
      output.push(compactedLog);
      insertedCompactedLog = true;
    }
    if (block.runNumber !== null && !preserved.has(block.runNumber)) continue;
    output.push(block.text);
  }
  if (!insertedCompactedLog) output.push(compactedLog);

  const compacted = output.join('');
  return {
    content: compacted,
    compactedRunNumbers,
    preservedRunNumbers,
    changed: compacted !== content,
  };
}

export async function compactFlywheelStateFile(cwd: string): Promise<FlywheelStateFileCompactionResult> {
  const path = join(cwd, 'docs', 'FLYWHEEL-STATE.md');
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { compacted: false, compactedRunNumbers: [], preservedRunNumbers: [] };
    }
    throw error;
  }

  const result = compactFlywheelState(content);
  if (result.changed) await writeFile(path, result.content, 'utf8');
  return {
    compacted: result.changed,
    compactedRunNumbers: result.compactedRunNumbers,
    preservedRunNumbers: result.preservedRunNumbers,
  };
}
