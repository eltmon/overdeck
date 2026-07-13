import { describe, expect, it } from 'vitest';
import { loadPromptFile } from '../../../evals/lib/prompt-harness.js';

describe('prompt load-bearing rails', () => {
  describe('roles/flywheel.md', () => {
    const prompt = loadPromptFile('roles/flywheel.md');

    it('requires the author/assignee gate', () => {
      expect(prompt).toMatch(/Author\/assignee gate/i);
      expect(prompt).toMatch(/author\.login\s*∈/);
    });

    it('treats vetoed as absolute', () => {
      expect(prompt).toMatch(/`vetoed` is absolute/i);
    });

    it('sets a saturation cap via maxAgents', () => {
      expect(prompt).toMatch(/Saturation cap/i);
      expect(prompt).toMatch(/maxAgents/);
    });

    it('defines the auto_pickup_backlog switch', () => {
      expect(prompt).toContain('auto_pickup_backlog');
    });

    it('states the auto-pickable predicate', () => {
      expect(prompt).toMatch(/ready && planned && \(released \|\| auto_pickup_backlog\)/);
    });
  });

  describe('roles/review.md', () => {
    const prompt = loadPromptFile('roles/review.md');

    it('defines the canonical synthesis blocker format', () => {
      expect(prompt).toContain('### [correctness] <title> — `path/to/file.ts:42`');
    });

    it('signals blocked status through the CLI', () => {
      expect(prompt).toMatch(/pan admin specialists done review.*--status blocked/);
    });

    it('signals passed status through the CLI', () => {
      expect(prompt).toMatch(/pan admin specialists done review.*--status passed/);
    });
  });

  describe('docs/flywheel-brief.md', () => {
    const prompt = loadPromptFile('docs/flywheel-brief.md');

    it('documents the auto_pickup_backlog switch', () => {
      expect(prompt).toContain('auto_pickup_backlog');
    });

    it('documents require_uat_before_merge', () => {
      expect(prompt).toContain('require_uat_before_merge');
    });
  });
});
