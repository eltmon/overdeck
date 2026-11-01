export type CitationSource = { kind: 'message'; messageId: string; role: 'assistant' | 'user' };

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

export function formatCitationBlock(citations: readonly PendingCitation[]): string {
  if (citations.length === 0) return '';

  const lines: string[] = [CITATION_BLOCK_HEADER];

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

  return lines.join('\n');
}

export function composePromptWithCitations(prompt: string, citations: readonly PendingCitation[]): string {
  if (citations.length === 0) return prompt;
  const block = formatCitationBlock(citations);
  return prompt.trim() === '' ? block : `${block}\n\n${prompt}`;
}
