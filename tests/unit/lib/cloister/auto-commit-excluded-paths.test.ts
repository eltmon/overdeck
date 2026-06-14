import { describe, it, expect } from 'vitest';
import {
  AUTO_COMMIT_EXCLUDED_PATHS,
  isAutoCommitExcludedPath,
} from '../../../../src/lib/cloister/merge-agent.js';

describe('AUTO_COMMIT_EXCLUDED_PATHS', () => {
  it('excludes the machine-local .panopticon/ config directory (PAN-1899)', () => {
    expect(AUTO_COMMIT_EXCLUDED_PATHS).toContain('.panopticon/');
  });
});

describe('isAutoCommitExcludedPath', () => {
  it('excludes the machine-local projects.yaml copied into every workspace (PAN-1899)', () => {
    expect(isAutoCommitExcludedPath('.panopticon/projects.yaml')).toBe(true);
  });

  it('excludes everything else under .panopticon/ (config.yaml, settings.json, nested files)', () => {
    expect(isAutoCommitExcludedPath('.panopticon/config.yaml')).toBe(true);
    expect(isAutoCommitExcludedPath('.panopticon/settings.json')).toBe(true);
    expect(isAutoCommitExcludedPath('.panopticon/claude-md/sections/01.md')).toBe(true);
  });

  it('excludes the bare .panopticon directory entry', () => {
    expect(isAutoCommitExcludedPath('.panopticon')).toBe(true);
  });

  it('does not over-match sibling paths that merely share the prefix', () => {
    expect(isAutoCommitExcludedPath('.panopticonfoo')).toBe(false);
  });

  it('still excludes the pre-existing denylisted paths', () => {
    expect(isAutoCommitExcludedPath('.pan/continue.json')).toBe(true);
    expect(isAutoCommitExcludedPath('.pan/spec.vbrief.json')).toBe(true);
    expect(isAutoCommitExcludedPath('.pan/handoff-abc.md')).toBe(true);
    expect(isAutoCommitExcludedPath('.claude/rules/foo.md')).toBe(true);
    expect(isAutoCommitExcludedPath('.claude/skills/bar/baz.md')).toBe(true);
  });

  it('does not exclude ordinary source or spec files', () => {
    expect(isAutoCommitExcludedPath('src/lib/template.ts')).toBe(false);
    expect(isAutoCommitExcludedPath('.pan/specs/2026-06-14-PAN-1862.vbrief.json')).toBe(false);
  });
});
