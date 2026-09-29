import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { transitionCancelledSpec } from '../issue-transitions.js';
import { generateXBriefFilename } from '../../xbrief/lifecycle.js';
import type { XBriefDocument } from '../../xbrief/types.js';

let TEST_DIR: string;
const issueId = 'PAN-9';

function makePlan(status: string): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
    plan: {
      id: 'pan-9',
      title: 'Plan for PAN-9',
      status,
      sequence: 1,
      created: '2026-05-03T00:00:00Z',
      items: [],
      edges: [],
    },
  };
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'issue-transitions-cancel-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('cancel', () => {
  describe('transitionCancelledSpec (PAN-4225)', () => {
    it('ac1: sets the spec top-level status to cancelled and returns a line mentioning "cancelled"', async () => {
      const specDir = join(TEST_DIR, '.pan', 'specs');
      mkdirSync(specDir, { recursive: true });
      const specPath = join(specDir, generateXBriefFilename('PAN-9', 'foo', '2026-05-03'));
      writeFileSync(specPath, JSON.stringify(makePlan('active'), null, 2), 'utf-8');

      const line = await transitionCancelledSpec(issueId, TEST_DIR);

      expect(line).toContain('cancelled');
      const doc = JSON.parse(readFileSync(specPath, 'utf-8')) as { status: string };
      expect(doc.status).toBe('cancelled');
    });

    it('ac2: returns the skip line and creates no file when planHome is null', async () => {
      const line = await transitionCancelledSpec(issueId, null);

      expect(line).toBe('xBRIEF cancel transition skipped: no workspace');
      expect(existsSync(TEST_DIR)).toBe(true);
      expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
    });

    it('ac2: returns the skip line when planHome points at a deleted directory', async () => {
      const goneDir = join(TEST_DIR, 'gone');

      const line = await transitionCancelledSpec(issueId, goneDir);

      expect(line).toBe('xBRIEF cancel transition skipped: no workspace');
      expect(existsSync(goneDir)).toBe(false);
    });

    it('ac3: leaves the primary plan home untouched in either branch', async () => {
      const primarySpecDir = join(TEST_DIR, '.pan', 'specs');
      mkdirSync(primarySpecDir, { recursive: true });
      const primarySpecPath = join(primarySpecDir, generateXBriefFilename('PAN-9', 'other', '2026-05-03'));
      writeFileSync(primarySpecPath, JSON.stringify(makePlan('active'), null, 2), 'utf-8');
      const before = readFileSync(primarySpecPath, 'utf-8');

      await transitionCancelledSpec(issueId, null);
      expect(readFileSync(primarySpecPath, 'utf-8')).toBe(before);

      const workspaceDir = join(TEST_DIR, 'workspaces', 'feature-pan-9');
      mkdirSync(join(workspaceDir, '.pan', 'specs'), { recursive: true });
      writeFileSync(
        join(workspaceDir, '.pan', 'specs', generateXBriefFilename('PAN-9', 'foo', '2026-05-03')),
        JSON.stringify(makePlan('active'), null, 2),
        'utf-8',
      );
      await transitionCancelledSpec(issueId, workspaceDir);
      expect(readFileSync(primarySpecPath, 'utf-8')).toBe(before);
    });
  });
});
