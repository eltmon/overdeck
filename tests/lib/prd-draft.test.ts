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
  let originalOverdeckHome: string | undefined;

  async function registerTestProject() {
    const { registerProjectSync } = await import('../../src/lib/projects.js');
    registerProjectSync('pan', {
      name: 'Overdeck Test',
      path: tempDir,
      issue_prefix: 'PAN',
    });
  }

  beforeEach(() => {
    // Create temp directory for isolated tests
    tempDir = mkdtempSync(join(tmpdir(), 'pan-prd-test-'));

    // Override OVERDECK_HOME for this test
    originalOverdeckHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = tempDir;

    // Clear module cache to reload with new env var
    vi.resetModules();

    // Create a minimal project registry with one project rooted at the temp dir
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original env var
    if (originalOverdeckHome) {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    } else {
      delete process.env.OVERDECK_HOME;
    }

    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getPRDDraftPath', () => {
    it('should return correct path for issue ID', async () => {
      const { getPRDDraftPathSync } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();
      const path = getPRDDraftPathSync('PAN-123');

      expect(path).toContain('pan-123.md');
      expect(path).toContain('drafts');
    });

    it('should lowercase the issue ID (PAN-3287)', async () => {
      const { getPRDDraftPathSync } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();
      const path = getPRDDraftPathSync('PAN-456');

      expect(path).toContain('pan-456.md');
    });
  });

  describe('hasPRDDraft', () => {
    it('should return false when draft does not exist', async () => {
      const { hasPRDDraft } = await import('../../src/lib/prd-draft.js');
      await registerTestProject();

      expect(await hasPRDDraft('PAN-NONEXISTENT')).toBe(false);
    });

    it('should return true when draft exists', async () => {
      const { hasPRDDraft } = await import('../../src/lib/prd-draft.js');
      const { writeIssueDraft } = await import('../../src/lib/pan-dir/index.js');
      await registerTestProject();

      await Effect.runPromise(writeIssueDraft(tempDir, 'PAN-123', '# Test PRD'));

      expect(await hasPRDDraft('PAN-123')).toBe(true);
    });
  });

});
