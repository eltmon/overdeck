import { describe, it, expect } from 'vitest';
import { parseSequenceMd } from '../sequence-io.js';

const VALID_DOC = {
  version: 1,
  project: 'overdeck',
  generatedAt: '2026-06-19T00:00:00Z',
  model: 'claude-opus-4-8',
  pass: 'creation',
  openCount: 2,
  nodes: [
    {
      issue: 'PAN-1',
      rank: 1,
      size: 'M',
      importance: 'high',
      score: 80,
      condition: 'ok',
      dependsOn: [],
      why: 'Core dependency.',
      gate: 'auto',
      planning: 'auto',
    },
    {
      issue: 'PAN-2',
      rank: 2,
      size: 'S',
      importance: 'medium',
      score: 60,
      condition: 'ok',
      dependsOn: ['PAN-1'],
      why: 'Depends on PAN-1.',
      gate: 'auto',
      planning: 'skip',
    },
  ],
  edges: [
    { from: 'PAN-1', to: 'PAN-2', type: 'unblocks', source: 'ai-inferred', confidence: 0.9 },
  ],
};

const MARKER = '<!-- machine-readable; do not hand-edit below this line -->';
const VALID_FENCED = `\`\`\`json\n${JSON.stringify(VALID_DOC, null, 2)}\n\`\`\``;

function makeSequenceMd(prose: string, json: string): string {
  return `# Backlog Sequence\n\n${prose}\n\n${MARKER}\n\n${json}\n`;
}

describe('parseSequenceMd', () => {
  it('returns a SequenceDoc for a valid sequence.md', () => {
    const md = makeSequenceMd('| rank | issue |\n|------|-------|\n| 1 | PAN-1 |', VALID_FENCED);
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes).toHaveLength(2);
      expect(result.doc.nodes[0].issue).toBe('PAN-1');
    }
  });

  it('returns parse-error for truncated JSON block', () => {
    const md = makeSequenceMd('', '```json\n{"version": "1",\n```');
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('returns parse-error when JSON block is absent', () => {
    const md = `# Backlog\n\nNo machine block here.\n`;
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(false);
  });

  it('uses JSON block values when human table disagrees', () => {
    const tableWithWrongCount = '| rank | issue |\n|------|-------|\n| 1 | PAN-99 |';
    const md = makeSequenceMd(tableWithWrongCount, VALID_FENCED);
    const result = parseSequenceMd(md);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.nodes[0].issue).toBe('PAN-1');
      expect(result.doc.nodes).toHaveLength(2);
    }
  });

  it('does not throw on empty string input', () => {
    expect(() => parseSequenceMd('')).not.toThrow();
    expect(parseSequenceMd('').ok).toBe(false);
  });
});
