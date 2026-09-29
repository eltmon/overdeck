import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { transitionStartedXBrief } from '../start-status.js';
import { generateXBriefFilename } from '../../../lib/xbrief/lifecycle.js';
import type { XBriefDocument } from '../../../lib/xbrief/types.js';

let TEST_DIR: string;
const issueId = 'PAN-7';

function workspaceDir(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-7');
}

function makePlan(status: string): XBriefDocument {
  return {
    xBRIEFInfo: { version: '0.5', created: '2026-05-03T00:00:00Z' },
    plan: {
      id: 'pan-7',
      title: 'Plan for PAN-7',
      status,
      sequence: 1,
      created: '2026-05-03T00:00:00Z',
      items: [],
      edges: [],
    },
  };
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'start-status-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('transitionStartedXBrief (PAN-4225)', () => {
  it('ac1: sets the workspace spec plan.status to running', async () => {
    const specDir = join(workspaceDir(), '.pan', 'specs');
    mkdirSync(specDir, { recursive: true });
    const specPath = join(specDir, generateXBriefFilename('PAN-7', 'foo', '2026-05-03'));
    writeFileSync(specPath, JSON.stringify(makePlan('proposed'), null, 2), 'utf-8');

    const result = await transitionStartedXBrief(TEST_DIR, issueId);

    expect(result.statusUpdated).toBe(true);
    const doc = JSON.parse(readFileSync(result.toPath, 'utf-8')) as XBriefDocument;
    expect(doc.plan.status).toBe('running');
  });

  it('ac2: leaves the primary checkout .pan/specs untouched', async () => {
    const specDir = join(workspaceDir(), '.pan', 'specs');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      join(specDir, generateXBriefFilename('PAN-7', 'foo', '2026-05-03')),
      JSON.stringify(makePlan('proposed'), null, 2),
      'utf-8',
    );

    await transitionStartedXBrief(TEST_DIR, issueId);

    expect(existsSync(join(TEST_DIR, '.pan', 'specs'))).toBe(false);
  });

  it('ac3: rejects with "no base workspace" and writes no file when the workspace is gone', async () => {
    await expect(transitionStartedXBrief(TEST_DIR, issueId)).rejects.toThrow(/no base workspace/);
    expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
    expect(existsSync(workspaceDir())).toBe(false);
  });
});
