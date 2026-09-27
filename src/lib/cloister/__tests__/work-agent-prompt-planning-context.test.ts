/**
 * PAN-4224: complete-planning now promotes the PRD draft onto the issue's
 * workspace plan home instead of the primary checkout, so the work-agent
 * kickoff prompt's PRD context (readPlanningContext, the source for
 * extractStitchDesigns) must resolve the workspace draft first, falling back
 * to the primary checkout for a draft an earlier, unfixed run left there.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readPlanningContext } from '../work-agent-prompt.js';
import { getDraftsDir } from '../../pan-dir/index.js';

let root: string;
let primaryRoot: string;
let workspacePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'work-agent-prompt-planning-'));
  primaryRoot = join(root, 'primary');
  workspacePath = join(primaryRoot, 'workspaces', 'feature-pan-9001');
  mkdirSync(workspacePath, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readPlanningContext', () => {
  it('reads the PRD draft from the workspace when it exists there', async () => {
    const wsDrafts = getDraftsDir(workspacePath);
    mkdirSync(wsDrafts, { recursive: true });
    writeFileSync(join(wsDrafts, 'pan-9001.md'), '# workspace draft\n', 'utf-8');

    await expect(readPlanningContext(workspacePath, primaryRoot)).resolves.toBe('# workspace draft\n');
  });

  it('falls back to the primary checkout when the workspace has no draft', async () => {
    const primaryDrafts = getDraftsDir(primaryRoot);
    mkdirSync(primaryDrafts, { recursive: true });
    writeFileSync(join(primaryDrafts, 'pan-9001.md'), '# primary draft\n', 'utf-8');

    await expect(readPlanningContext(workspacePath, primaryRoot)).resolves.toBe('# primary draft\n');
  });

  it('prefers the workspace draft over the primary checkout when both exist', async () => {
    const wsDrafts = getDraftsDir(workspacePath);
    mkdirSync(wsDrafts, { recursive: true });
    writeFileSync(join(wsDrafts, 'pan-9001.md'), '# workspace draft\n', 'utf-8');
    const primaryDrafts = getDraftsDir(primaryRoot);
    mkdirSync(primaryDrafts, { recursive: true });
    writeFileSync(join(primaryDrafts, 'pan-9001.md'), '# primary draft\n', 'utf-8');

    await expect(readPlanningContext(workspacePath, primaryRoot)).resolves.toBe('# workspace draft\n');
  });

  it('returns null when neither the workspace nor the primary has a draft', async () => {
    await expect(readPlanningContext(workspacePath, primaryRoot)).resolves.toBeNull();
  });

  it('returns null when the workspace path does not encode an issue id', async () => {
    const notAFeatureDir = join(root, 'not-a-feature-dir');
    mkdirSync(notAFeatureDir, { recursive: true });

    await expect(readPlanningContext(notAFeatureDir, primaryRoot)).resolves.toBeNull();
  });
});
