/**
 * Unit tests for Q&A / approval prompt detection in tmux output.
 * Tests the detectQaPromptInOutput function with the default pattern set.
 */
import { describe, it, expect } from 'vitest';
import { detectQaPromptInOutput } from '../deacon.js';

const PROMPT_FIXTURES = [
  { label: '[y/N] yes/no prompt', input: 'Do you want to save changes? [y/N]', shouldMatch: true },
  { label: '[y/n/?] prompt', input: 'Overwrite existing file? [y/n/?]', shouldMatch: true },
  { label: 'Do you want to proceed?', input: 'Do you want to proceed?', shouldMatch: true },
  { label: 'Press any key to continue', input: 'Press any key to continue...', shouldMatch: true },
  { label: 'Waiting for input', input: 'Waiting for input from user', shouldMatch: true },
  { label: 'Standalone > prompt', input: 'some output\n> \n', shouldMatch: true },
  { label: 'claude-code approval prompt', input: 'claude-code approval prompt: allow tool use?', shouldMatch: true },
  { label: 'Approve? [y/N]', input: 'Approve? [y/N]', shouldMatch: true },
];

const NON_PROMPT_FIXTURES = [
  { label: 'Normal stdout progress', input: 'Building... 45%\n[=====     ]\nDone' },
  { label: 'ANSI color output', input: '\u001b[32m✓\u001b[0m Tests passed (42/42)' },
  { label: 'npm install output', input: 'added 234 packages in 3s\n2.4 MB/s' },
  { label: 'TypeScript build output', input: 'src/index.ts → dist/index.js (1.2s)' },
  { label: 'Git log output', input: 'commit abc123\nAuthor: agent\nDate:   Mon Apr 14 2026' },
  { label: 'Vitest test output', input: '✓ src/lib/__tests__/foo.test.ts (5 tests)', },
  { label: 'Claude Code thinking', input: '● Thinking… (2m 31s · $0.023)' },
  { label: 'Tool use output', input: '● Read /path/to/file.ts\n   1  import { foo } from ...' },
  { label: 'Arrow in code', input: 'const x = items => items.filter(i => i.active)' },
  { label: 'Greater-than in code', input: 'if (count > 0) { process(items); }' },
  { label: 'JSON output', input: '{"status":"ok","count":42}' },
  { label: 'Shell prompt with text', input: 'user@host:~/projects$ git status' },
];

describe('detectQaPromptInOutput', () => {
  describe('true positives (should detect as Q&A)', () => {
    for (const fixture of PROMPT_FIXTURES) {
      it(`detects: ${fixture.label}`, () => {
        const result = detectQaPromptInOutput(fixture.input);
        expect(result).not.toBeNull();
      });
    }
  });

  describe('true negatives (should NOT detect as Q&A)', () => {
    for (const fixture of NON_PROMPT_FIXTURES) {
      it(`does not detect: ${fixture.label}`, () => {
        const result = detectQaPromptInOutput(fixture.input);
        expect(result).toBeNull();
      });
    }
  });

  it('returns null for empty output', () => {
    expect(detectQaPromptInOutput('')).toBeNull();
    expect(detectQaPromptInOutput('   \n\n  ')).toBeNull();
  });

  it('accepts custom patterns override', () => {
    const customPatterns = [/CUSTOM_PROMPT/i];
    expect(detectQaPromptInOutput('CUSTOM_PROMPT here', customPatterns)).not.toBeNull();
    expect(detectQaPromptInOutput('[y/N]', customPatterns)).toBeNull(); // Default patterns not used
  });

  it('false positive rate < 5% on non-prompt fixtures', () => {
    const falsePositives = NON_PROMPT_FIXTURES.filter(f => detectQaPromptInOutput(f.input) !== null);
    const rate = falsePositives.length / NON_PROMPT_FIXTURES.length;
    if (falsePositives.length > 0) {
      console.warn('False positives:', falsePositives.map(f => f.label));
    }
    expect(rate).toBeLessThan(0.05);
  });
});
