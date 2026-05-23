import { Effect } from 'effect';
/**
 * Tests for PRD Draft management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('prd-draft', () => {
  let tempDir: string;
  let originalPanopticonHome: string | undefined;

  async function registerTestProject() {
    const { registerProjectSync } = await import('../../src/lib/projects.js');
    registerProjectSync('pan', {
      name: 'Panopticon Test',
      path: tempDir,
      issue_prefix: 'PAN',
    });
  }

  beforeEach(() => {
    // Create temp directory for isolated tests
    tempDir = mkdtempSync(join(tmpdir(), 'pan-prd-test-'));

    // Override PANOPTICON_HOME for this test
    originalPanopticonHome = process.env.PANOPTICON_HOME;
    process.env.PANOPTICON_HOME = tempDir;

    // Clear module cache to reload with new env var
    vi.resetModules();

    // Create a minimal project registry with one project rooted at the temp dir
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original env var
    if (originalPanopticonHome) {
      process.env.PANOPTICON_HOME = originalPanopticonHome;
    } else {
      delete process.env.PANOPTICON_HOME;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPRDDraftPath', () => {
    it('should return correct path for issue ID', async () => {
      const { getPRDDraftPathSync } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();
      const path = getPRDDraftPathSync('PAN-123');

      expect(path).toContain('PAN-123.md');
      expect(path).toContain('drafts');
    });

    it('should uppercase the issue ID', async () => {
      const { getPRDDraftPathSync } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();
      const path = getPRDDraftPathSync('pan-456');

      expect(path).toContain('PAN-456.md');
    });
  });

  describe('hasPRDDraft', () => {
    it('should return false when draft does not exist', async () => {
      const { hasPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      expect(await Effect.runPromise(hasPRDDraft('PAN-NONEXISTENT'))).toBe(false);
    });

    it('should return true when draft exists', async () => {
      const { hasPRDDraft, writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Test PRD'));

      expect(await Effect.runPromise(hasPRDDraft('PAN-123'))).toBe(true);
    });
  });

  describe('readPRDDraft', () => {
    it('should return null when draft does not exist', async () => {
      const { readPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      expect(await Effect.runPromise(readPRDDraft('PAN-NONEXISTENT'))).toBeNull();
    });

    it('should return content when draft exists', async () => {
      const { readPRDDraft, writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      const content = '# Test PRD\n\nThis is a test.';
      await Effect.runPromise(writePRDDraft('PAN-123', content));

      expect(await Effect.runPromise(readPRDDraft('PAN-123'))).toBe(content);
    });
  });

  describe('writePRDDraft', () => {
    it('should create draft file', async () => {
      const { writePRDDraft, hasPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Test PRD'));

      expect(await Effect.runPromise(hasPRDDraft('PAN-123'))).toBe(true);
    });

    it('should return the file path', async () => {
      const { writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      const path = await Effect.runPromise(writePRDDraft('PAN-123', '# Test PRD'));

      expect(path).toContain('PAN-123.md');
    });

    it('should overwrite existing draft', async () => {
      const { writePRDDraft, readPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Original'));
      await Effect.runPromise(writePRDDraft('PAN-123', '# Updated'));

      expect(await Effect.runPromise(readPRDDraft('PAN-123'))).toBe('# Updated');
    });
  });

  describe('listPRDDrafts', () => {
    it('should return empty array when no drafts exist', async () => {
      const { listPRDDrafts } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      expect(await Effect.runPromise(listPRDDrafts())).toEqual([]);
    });

    it('should return list of draft issue IDs', async () => {
      const { listPRDDrafts, writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Test 1'));
      await Effect.runPromise(writePRDDraft('PAN-456', '# Test 2'));

      const drafts = await Effect.runPromise(listPRDDrafts());
      expect(drafts).toHaveLength(2);
      expect(drafts).toContain('PAN-123');
      expect(drafts).toContain('PAN-456');
    });
  });

  describe('deletePRDDraft', () => {
    it('should return false when draft does not exist', async () => {
      const { deletePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      expect(await Effect.runPromise(deletePRDDraft('PAN-NONEXISTENT'))).toBe(false);
    });

    it('should delete existing draft and return true', async () => {
      const { deletePRDDraft, writePRDDraft, hasPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Test PRD'));
      const result = await Effect.runPromise(deletePRDDraft('PAN-123'));

      expect(result).toBe(true);
      expect(await Effect.runPromise(hasPRDDraft('PAN-123'))).toBe(false);
    });

    it('should move draft to deleted folder', async () => {
      const { deletePRDDraft, writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      await Effect.runPromise(writePRDDraft('PAN-123', '# Test PRD'));
      await Effect.runPromise(deletePRDDraft('PAN-123'));

      const deletedDir = join(tempDir, '.pan', 'drafts', 'deleted');
      const files = await import('fs').then(fs => fs.readdirSync(deletedDir));
      expect(files.some(f => f.startsWith('PAN-123-'))).toBe(true);
    });
  });

  describe('getPRDDraftInfo', () => {
    it('should return exists false when draft does not exist', async () => {
      const { getPRDDraftInfo } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      const info = await Effect.runPromise(getPRDDraftInfo('PAN-NONEXISTENT'));

      expect(info.exists).toBe(false);
      expect(info.path).toBeUndefined();
      expect(info.size).toBeUndefined();
      expect(info.modified).toBeUndefined();
    });

    it.skip('should return correct info for existing draft', async () => {
      const { getPRDDraftInfo, writePRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      const content = '# Test PRD\nSome content here';
      await Effect.runPromise(writePRDDraft('PAN-123', content));

      const info = await Effect.runPromise(getPRDDraftInfo('PAN-123'));

      expect(info.exists).toBe(true);
      expect(info.path).toContain('PAN-123.md');
      expect(info.size).toBe(content.length);
      expect(info.modified).toBeInstanceOf(Date);
      expect(info.modified!.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

});
