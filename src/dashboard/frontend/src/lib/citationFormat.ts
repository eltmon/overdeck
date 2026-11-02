export type CitationSource =
  | { kind: 'message'; messageId: string; role: 'assistant' | 'user' }
  | { kind: 'file'; path: string };

export interface PendingCitation {
  id: string;
  source: CitationSource;
  /** Trimmed selection text, never empty. */
  quotedText: string;
  /** Trimmed; '' means no comment. */
  comment: string;
  /** ISO 8601. */
  createdAt: string;
}

export const CITATION_BLOCK_HEADER = 'Notes on your previous reply:';

function stripTrailingWhitespace(line: string): string {
  return line.replace(/[ \t]+$/, '');
}

export function fileCitationHeader(path: string): string {
  return 'Notes on `' + path + '`:';
}

function formatEntries(citations: readonly PendingCitation[]): string[] {
  const lines: string[] = [];

  citations.forEach((citation, index) => {
    const prefix = `${index + 1}. `;
    const indent = ' '.repeat(prefix.length);

    const quoteLines = citation.quotedText.trim().split('\n').map(stripTrailingWhitespace);
    quoteLines.forEach((line, lineIndex) => {
      if (lineIndex === 0) {
        lines.push(`${prefix}> ${line}`);
      } else {
        lines.push(line === '' ? `${indent}>` : `${indent}> ${line}`);
      }
    });

    const trimmedComment = citation.comment.trim();
    if (trimmedComment !== '') {
      trimmedComment.split('\n').map(stripTrailingWhitespace).forEach((line) => {
        lines.push(line === '' ? '' : `${indent}${line}`);
      });
    }
  });

  return lines;
}

export function formatCitationBlock(citations: readonly PendingCitation[]): string {
  if (citations.length === 0) return '';

  const blocks: string[] = [];

  const messages = citations.filter((c) => c.source.kind === 'message');
  if (messages.length > 0) blocks.push([CITATION_BLOCK_HEADER, ...formatEntries(messages)].join('\n'));

  const byPath = new Map<string, PendingCitation[]>();
  for (const c of citations) {
    if (c.source.kind !== 'file') continue;
    const group = byPath.get(c.source.path);
    if (group) group.push(c);
    else byPath.set(c.source.path, [c]);
  }
  for (const [path, group] of byPath) {
    blocks.push([fileCitationHeader(path), ...formatEntries(group)].join('\n'));
  }

  return blocks.join('\n\n');
}

export function composePromptWithCitations(prompt: string, citations: readonly PendingCitation[]): string {
  if (citations.length === 0) return prompt;
  const block = formatCitationBlock(citations);
  return prompt.trim() === '' ? block : `${block}\n\n${prompt}`;
}
