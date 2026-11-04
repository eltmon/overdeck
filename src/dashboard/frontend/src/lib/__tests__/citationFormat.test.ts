import { describe, it, expect } from 'vitest';
import {
  CITATION_BLOCK_HEADER,
  composePromptWithCitations,
  formatCitationBlock,
  type PendingCitation,
} from '../citationFormat.js';

function makeCitation(overrides: Partial<PendingCitation> & { quotedText: string }): PendingCitation {
  return {
    id: `citation-${Math.random()}`,
    source: { kind: 'message', messageId: 'msg-1', role: 'assistant' },
    comment: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('composePromptWithCitations', () => {
  it('reproduces the PRD WI-2 fixture exactly', () => {
    const citations: PendingCitation[] = [
      makeCitation({ quotedText: 'First line\nsecond line', comment: "I don't agree" }),
      makeCitation({ quotedText: 'Use X' }),
    ];

    const result = composePromptWithCitations('Please revise.', citations);

    expect(result).toBe(
      [
        'Notes on your previous reply:',
        '1. > First line',
        '   > second line',
        "   I don't agree",
        '2. > Use X',
        '',
        'Please revise.',
      ].join('\n'),
    );
  });

  it('returns the prompt unchanged for an empty citation list', () => {
    expect(composePromptWithCitations('Please revise.', [])).toBe('Please revise.');
  });

  it('returns the block alone with no trailing blank lines when the prompt is empty', () => {
    const citations: PendingCitation[] = [makeCitation({ quotedText: 'Use X' })];
    expect(composePromptWithCitations('', citations)).toBe(`${CITATION_BLOCK_HEADER}\n1. > Use X`);
  });

  it('treats a whitespace-only prompt as empty', () => {
    const citations: PendingCitation[] = [makeCitation({ quotedText: 'Use X' })];
    expect(composePromptWithCitations('   \n  ', citations)).toBe(`${CITATION_BLOCK_HEADER}\n1. > Use X`);
  });
});

describe('formatCitationBlock', () => {
  it('returns an empty string for an empty list', () => {
    expect(formatCitationBlock([])).toBe('');
  });

  it('indents a tenth entry by four spaces', () => {
    const citations: PendingCitation[] = Array.from({ length: 10 }, (_, i) =>
      makeCitation({ quotedText: `Quote ${i + 1}\ncontinued`, comment: i === 9 ? 'final comment' : '' }),
    );

    const block = formatCitationBlock(citations);
    const lines = block.split('\n');

    const tenthIndex = lines.indexOf('10. > Quote 10');
    expect(tenthIndex).toBeGreaterThan(-1);
    expect(lines[tenthIndex + 1]).toBe('    > continued');
    expect(lines[tenthIndex + 2]).toBe('    final comment');
  });

  it('renders a blank quote line as the bare indent marker', () => {
    const citations: PendingCitation[] = [makeCitation({ quotedText: 'First\n\nThird' })];
    const block = formatCitationBlock(citations);
    expect(block.split('\n')).toEqual([
      CITATION_BLOCK_HEADER,
      '1. > First',
      '   >',
      '   > Third',
    ]);
  });

  it('omits the comment line entirely when the comment is empty', () => {
    const citations: PendingCitation[] = [makeCitation({ quotedText: 'Use X', comment: '   ' })];
    expect(formatCitationBlock(citations)).toBe(`${CITATION_BLOCK_HEADER}\n1. > Use X`);
  });

  it('groups file citations by path, after the message block, in first-appearance order', () => {
    const citations: PendingCitation[] = [
      makeCitation({
        source: { kind: 'file', path: '/repo/docs/guide.md' },
        quotedText: 'Step two\nis wrong',
        comment: 'Swap the order',
      }),
      makeCitation({ quotedText: 'Use X' }),
      makeCitation({ source: { kind: 'file', path: '/repo/docs/guide.md' }, quotedText: 'Done.' }),
      makeCitation({
        source: { kind: 'file', path: '/repo/README.md' },
        quotedText: 'Install',
        comment: 'Mention bun',
      }),
    ];

    const result = composePromptWithCitations('Please fix.', citations);

    expect(result).toBe(
      [
        'Notes on your previous reply:',
        '1. > Use X',
        '',
        'Notes on `/repo/docs/guide.md`:',
        '1. > Step two',
        '   > is wrong',
        '   Swap the order',
        '2. > Done.',
        '',
        'Notes on `/repo/README.md`:',
        '1. > Install',
        '   Mention bun',
        '',
        'Please fix.',
      ].join('\n'),
    );
  });

  it('produces no "Notes on your previous reply:" line for a file-only list', () => {
    const citations: PendingCitation[] = [
      makeCitation({ source: { kind: 'file', path: '/repo/docs/guide.md' }, quotedText: 'Use X' }),
    ];
    expect(formatCitationBlock(citations)).not.toContain(CITATION_BLOCK_HEADER);
  });
});
