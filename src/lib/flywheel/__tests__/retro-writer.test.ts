/**
 * Unit tests for retro markdown writer + schema validation (PAN-709, bead eeb)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateRetro, parseRetroMarkdown, writeRetro, type RetroDocument } from '../retro-writer.js';

const TEST_DIR = join(tmpdir(), `retro-writer-test-${Date.now()}`);

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

const VALID_RETRO: RetroDocument = {
  frontmatter: {
    issue: 'PAN-709',
    agent: 'retro-agent',
    run: 'event',
    cycle_count: 0,
    friction_score: 3,
    surprise: true,
    proposed_changes: [
      { type: 'add_skill', name: 'retro-workflow', audience: 'agent', purpose: 'Document retro process' },
    ],
  },
  body: '# Retro: PAN-709\n\n## What surprised me\n\nThe agent improvised a skill that should have existed.\n',
};

const VALID_NOOP_RETRO: RetroDocument = {
  frontmatter: {
    issue: 'PAN-710',
    agent: 'retro-agent',
    run: 1,
    cycle_count: 0,
    friction_score: 1,
    surprise: false,
    proposed_changes: [{ type: 'no_op', reason: 'Routine merge, no surprises' }],
  },
  body: '# Retro: PAN-710\n\nRoutine merge, no surprises: code worked as expected.',
};

describe('validateRetro', () => {
  it('validates a well-formed retro with proposed changes', () => {
    const result = validateRetro(VALID_RETRO);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates a no-op retro', () => {
    const result = validateRetro(VALID_NOOP_RETRO);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a retro with empty proposed_changes array', () => {
    const doc: RetroDocument = {
      ...VALID_RETRO,
      frontmatter: { ...VALID_RETRO.frontmatter, proposed_changes: [] },
    };
    const result = validateRetro(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'proposed_changes')).toBe(true);
  });

  it('rejects an invalid friction_score (> 10)', () => {
    const doc: RetroDocument = {
      ...VALID_RETRO,
      frontmatter: { ...VALID_RETRO.frontmatter, friction_score: 11 },
    };
    const result = validateRetro(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'friction_score')).toBe(true);
  });

  it('rejects an invalid friction_score (< 0)', () => {
    const doc: RetroDocument = {
      ...VALID_RETRO,
      frontmatter: { ...VALID_RETRO.frontmatter, friction_score: -1 },
    };
    const result = validateRetro(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'friction_score')).toBe(true);
  });

  it('rejects a non-boolean surprise value', () => {
    const doc: RetroDocument = {
      ...VALID_RETRO,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      frontmatter: { ...VALID_RETRO.frontmatter, surprise: 'yes' as any },
    };
    const result = validateRetro(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'surprise')).toBe(true);
  });

  it('rejects missing issue field', () => {
    const doc: RetroDocument = {
      ...VALID_RETRO,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      frontmatter: { ...VALID_RETRO.frontmatter, issue: '' as any },
    };
    const result = validateRetro(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'issue')).toBe(true);
  });
});

describe('writeRetro', () => {
  const VALID_RETRO_MD = `---
issue: PAN-709
agent: retro-agent
run: event
cycle_count: 0
friction_score: 3
surprise: true
proposed_changes:
  - type: add_skill | name: retro-workflow | audience: agent | purpose: Document retro process
---

# Retro: PAN-709

## What surprised me

The agent improvised a skill.
`;

  it('writes a valid retro to the retros directory', async () => {
    const path = await writeRetro(VALID_RETRO_MD, 'PAN-709', TEST_DIR);
    expect(existsSync(path)).toBe(true);
    expect(path).toContain('pan-709-');
    expect(path).toMatch(/\.md$/);
  });

  it('throws on retro with no frontmatter', async () => {
    await expect(writeRetro('# No frontmatter\n\nJust a body.', 'PAN-709', TEST_DIR))
      .rejects.toThrow('frontmatter');
  });

  it('throws on retro that fails schema validation', async () => {
    const invalid = `---
issue: PAN-709
agent: retro-agent
run: event
cycle_count: 0
friction_score: 99
surprise: true
proposed_changes: []
---

# Invalid retro
`;
    await expect(writeRetro(invalid, 'PAN-709', TEST_DIR))
      .rejects.toThrow('validation failed');
  });
});
