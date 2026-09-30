export type ChunkMatchKind = 'text' | 'path';

/** Lowercased, deduplicated query terms; same term regex as ranker.buildMarkedExcerpt. */
export function queryTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])];
}

interface Range {
  start: number;
  end: number;
}

const FENCED_BLOCK_RE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const PATH_TOKEN_RE = /[^\s<>"'`()[\]{},;]*\/[^\s<>"'`()[\]{},;]*/g;

function collectRanges(text: string, re: RegExp): Range[] {
  const ranges: Range[] = [];
  for (const match of text.matchAll(re)) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function isFullyInsideAnyRange(start: number, end: number, ranges: Range[]): boolean {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

export function classifyChunkMatch(text: string, query: string): ChunkMatchKind {
  const terms = queryTerms(query);
  if (terms.length === 0) return 'text';

  const nonProseRanges = [
    ...collectRanges(text, FENCED_BLOCK_RE),
    ...collectRanges(text, INLINE_CODE_RE),
    ...collectRanges(text, PATH_TOKEN_RE),
  ];

  const lower = text.toLowerCase();
  let occurrenceCount = 0;

  for (const term of terms) {
    let fromIndex = 0;
    for (;;) {
      const index = lower.indexOf(term, fromIndex);
      if (index === -1) break;
      occurrenceCount += 1;
      if (!isFullyInsideAnyRange(index, index + term.length, nonProseRanges)) {
        return 'text';
      }
      fromIndex = index + term.length;
    }
  }

  if (occurrenceCount === 0) return 'text';
  return 'path';
}
