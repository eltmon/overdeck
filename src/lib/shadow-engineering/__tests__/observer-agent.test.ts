import { describe, it, expect } from 'vitest';
import { generateObservation, generateObserverPrompt } from '../observer-agent.js';
import type { PRInfo, ObserverAgentConfig } from '../observer-agent.js';

describe('Observer Agent', () => {
  const baseConfig: ObserverAgentConfig = {
    issueId: 'PAN-100',
    workspacePath: '/tmp/test-workspace',
    projectPath: '/tmp/test-project',
    repo: 'testorg/testrepo',
    mode: 'watch',
  };

  const basePR: PRInfo = {
    number: 42,
    title: 'feat: add new feature',
    author: 'developer1',
    branch: 'feature/pan-100',
    state: 'open',
    body: 'This PR implements the new feature.',
    additions: 100,
    deletions: 20,
    changedFiles: 5,
    comments: [],
  };

  describe('generateObservation', () => {
    it('should generate observation for a PR', () => {
      const result = generateObservation(basePR, null, baseConfig);

      expect(result).not.toBeNull();
      expect(result).toContain('[Shadow Engineering Observer]');
      expect(result).toContain('#42');
      expect(result).toContain('+100/-20');
      expect(result).toContain('5 file(s)');
    });

    it('should skip PRs already commented on', () => {
      const pr: PRInfo = {
        ...basePR,
        comments: [{
          author: 'shadow-bot',
          body: '[Shadow Engineering Observer] - Observations for #42',
          createdAt: '2026-01-01T00:00:00Z',
        }],
      };

      const result = generateObservation(pr, null, baseConfig);
      expect(result).toBeNull();
    });

    it('should note large PRs', () => {
      const largePR: PRInfo = {
        ...basePR,
        additions: 400,
        deletions: 200,
      };

      const result = generateObservation(largePR, null, baseConfig);

      expect(result).not.toBeNull();
      expect(result).toContain('large PR');
      expect(result).toContain('600 lines');
    });

    it('should note PRs with many files', () => {
      const manyFilesPR: PRInfo = {
        ...basePR,
        changedFiles: 25,
      };

      const result = generateObservation(manyFilesPR, null, baseConfig);

      expect(result).not.toBeNull();
      expect(result).toContain('25 files');
    });

    it('should mention inference document alignment when present', () => {
      const inference = '# Understanding: Building a dashboard';

      const result = generateObservation(basePR, inference, baseConfig);

      expect(result).not.toBeNull();
      expect(result).toContain('Inference Document');
    });
  });

  describe('generateObserverPrompt', () => {
    it('should include watch-only mode restrictions', () => {
      const result = generateObserverPrompt(baseConfig, [], null);

      expect(result).toContain('WATCH-ONLY');
      expect(result).toContain('may NOT create PRs');
    });

    it('should include propose mode capabilities', () => {
      const proposeConfig = { ...baseConfig, mode: 'propose' as const };
      const result = generateObserverPrompt(proposeConfig, [], null);

      expect(result).toContain('PROPOSE');
      expect(result).toContain('can create PRs when asked');
    });

    it('should include PR details', () => {
      const result = generateObserverPrompt(baseConfig, [basePR], null);

      expect(result).toContain('PR #42');
      expect(result).toContain('feat: add new feature');
      expect(result).toContain('developer1');
    });

    it('should include inference document when present', () => {
      const inference = '# Team is building a monitoring dashboard';

      const result = generateObserverPrompt(baseConfig, [], inference);

      expect(result).toContain('## Inference Document');
      expect(result).toContain('monitoring dashboard');
    });

    it('should note when no PRs found', () => {
      const result = generateObserverPrompt(baseConfig, [], null);

      expect(result).toContain('No PRs found');
    });
  });
});
