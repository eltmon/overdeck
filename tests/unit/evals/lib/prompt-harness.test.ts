import { describe, expect, it } from 'vitest';
import { extractJsonArray, loadPromptFile, runPromptScenario } from '../../../../evals/lib/prompt-harness.js';

describe('evals/lib/prompt-harness', () => {
  describe('loadPromptFile', () => {
    it('returns the file content for roles/flywheel.md', () => {
      const content = loadPromptFile('roles/flywheel.md');
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain('flywheel');
    });

    it('throws a descriptive error for a missing path', () => {
      expect(() => loadPromptFile('roles/does-not-exist.md')).toThrow(
        /Prompt file not found: roles\/does-not-exist\.md/,
      );
    });
  });

  describe('runPromptScenario', () => {
    it('rejects before any network call when OVERDECK_EVAL_MODEL is unset', async () => {
      const original = process.env['OVERDECK_EVAL_MODEL'];
      delete process.env['OVERDECK_EVAL_MODEL'];

      await expect(runPromptScenario({ system: 'system prompt', user: 'user prompt' })).rejects.toThrow(
        /OVERDECK_EVAL_MODEL is not set/,
      );

      if (original !== undefined) {
        process.env['OVERDECK_EVAL_MODEL'] = original;
      }
    });
  });

  describe('extractJsonArray', () => {
    it('returns the parsed array for a response wrapped in a json code fence', () => {
      const text = '```json\n[{"id": 1}, {"id": 2}]\n```';
      expect(extractJsonArray(text)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('returns the parsed array for a plain response', () => {
      const text = '[1, 2, 3]';
      expect(extractJsonArray(text)).toEqual([1, 2, 3]);
    });

    it('throws a descriptive error when the text contains no JSON array', () => {
      expect(() => extractJsonArray('just plain text')).toThrow(/No JSON array found in response/);
    });
  });
});
