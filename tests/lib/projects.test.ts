import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getSpecialistConfig,
  getSpecialistRetention,
  getSpecialistPromptOverride,
} from '../../src/lib/projects.js';

describe('projects - specialist config', () => {
  const testDir = join(tmpdir(), 'panopticon-test-projects');
  const originalPanopticonHome = process.env.PANOPTICON_HOME;

  beforeEach(() => {
    process.env.PANOPTICON_HOME = testDir;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    process.env.PANOPTICON_HOME = originalPanopticonHome;
  });

  describe('getSpecialistConfig', () => {
    it('should return default config when no project exists', () => {
      const config = getSpecialistConfig('nonexistent');

      expect(config).toEqual({
        context_runs: 5,
        digest_model: null,
        retention: {
          max_days: 30,
          max_runs: 50,
        },
        prompts: {},
      });
    });

    it('should return default config when project has no specialists config', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config).toEqual({
        context_runs: 5,
        digest_model: null,
        retention: {
          max_days: 30,
          max_runs: 50,
        },
        prompts: {},
      });
    });

    it('should merge partial specialist config with defaults', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      context_runs: 10
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config).toEqual({
        context_runs: 10,
        digest_model: null,
        retention: {
          max_days: 30,
          max_runs: 50,
        },
        prompts: {},
      });
    });

    it('should use custom digest_model when specified', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      digest_model: "claude-opus-4-6"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config.digest_model).toBe('claude-opus-4-6');
    });

    it('should use custom retention policy when specified', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      retention:
        max_days: 60
        max_runs: 100
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config.retention).toEqual({
        max_days: 60,
        max_runs: 100,
      });
    });

    it('should merge partial retention policy with defaults', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      retention:
        max_days: 60
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config.retention).toEqual({
        max_days: 60,
        max_runs: 50, // default
      });
    });

    it('should include custom prompts when specified', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        review-agent: "Focus on security"
        test-agent: "Test edge cases"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config.prompts).toEqual({
        'review-agent': 'Focus on security',
        'test-agent': 'Test edge cases',
      });
    });

    it('should handle full specialist config', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      context_runs: 10
      digest_model: "claude-sonnet-4-5"
      retention:
        max_days: 45
        max_runs: 75
      prompts:
        review-agent: "Custom review prompt"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const config = getSpecialistConfig('testproject');

      expect(config).toEqual({
        context_runs: 10,
        digest_model: 'claude-sonnet-4-5',
        retention: {
          max_days: 45,
          max_runs: 75,
        },
        prompts: {
          'review-agent': 'Custom review prompt',
        },
      });
    });
  });

  describe('getSpecialistRetention', () => {
    it('should return default retention when no project exists', () => {
      const retention = getSpecialistRetention('nonexistent');

      expect(retention).toEqual({
        max_days: 30,
        max_runs: 50,
      });
    });

    it('should return custom retention when specified', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      retention:
        max_days: 90
        max_runs: 200
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const retention = getSpecialistRetention('testproject');

      expect(retention).toEqual({
        max_days: 90,
        max_runs: 200,
      });
    });

    it('should merge partial retention with defaults', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      retention:
        max_runs: 150
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const retention = getSpecialistRetention('testproject');

      expect(retention).toEqual({
        max_days: 30, // default
        max_runs: 150,
      });
    });
  });

  describe('getSpecialistPromptOverride', () => {
    it('should return null when no project exists', () => {
      const prompt = getSpecialistPromptOverride('nonexistent', 'review-agent');

      expect(prompt).toBeNull();
    });

    it('should return null when no prompts configured', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'review-agent');

      expect(prompt).toBeNull();
    });

    it('should return null when specialist type not configured', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        test-agent: "Test prompt"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'review-agent');

      expect(prompt).toBeNull();
    });

    it('should return custom prompt for review-agent', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        review-agent: "Focus on API compatibility"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'review-agent');

      expect(prompt).toBe('Focus on API compatibility');
    });

    it('should return custom prompt for test-agent', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        test-agent: "Test edge cases thoroughly"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'test-agent');

      expect(prompt).toBe('Test edge cases thoroughly');
    });

    it('should return custom prompt for merge-agent', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        merge-agent: "Check for breaking changes"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'merge-agent');

      expect(prompt).toBe('Check for breaking changes');
    });

    it('should handle multiple specialist prompts', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        review-agent: "Review prompt"
        test-agent: "Test prompt"
        merge-agent: "Merge prompt"
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      expect(getSpecialistPromptOverride('testproject', 'review-agent')).toBe('Review prompt');
      expect(getSpecialistPromptOverride('testproject', 'test-agent')).toBe('Test prompt');
      expect(getSpecialistPromptOverride('testproject', 'merge-agent')).toBe('Merge prompt');
    });

    it('should handle multiline prompts', () => {
      const projectsFile = join(testDir, 'projects.yaml');
      const yaml = `
projects:
  testproject:
    name: "Test Project"
    path: /path/to/project
    specialists:
      prompts:
        review-agent: |
          Pay special attention to:
          - Security vulnerabilities
          - Performance implications
          - Breaking changes
`;
      writeFileSync(projectsFile, yaml, 'utf-8');

      const prompt = getSpecialistPromptOverride('testproject', 'review-agent');

      expect(prompt).toContain('Pay special attention to:');
      expect(prompt).toContain('Security vulnerabilities');
      expect(prompt).toContain('Performance implications');
      expect(prompt).toContain('Breaking changes');
    });
  });
});
