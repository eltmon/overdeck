import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';

import { promoteWorkspacePrdDraft, getDraftsDir, getIssueDraftPath } from '../drafts.js';

let projectRoot: string;
let workspaceRoot: string;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'prd-promote-project-'));
  workspaceRoot = mkdtempSync(join(tmpdir(), 'prd-promote-ws-'));
  // promoteWorkspacePrdDraft resolves the project root through git; give it
  // a real repo on main so path resolution succeeds instead of erroring.
  git(['init', '-b', 'main'], projectRoot);
  git(['config', 'user.email', 'test@test.invalid'], projectRoot);
  git(['config', 'user.name', 'test'], projectRoot);
  git(['commit', '--allow-empty', '-m', 'init'], projectRoot);
});

afterEach(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  if (existsSync(workspaceRoot)) rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('promoteWorkspacePrdDraft', () => {
  it('promotes a workspace-authored draft when no canonical draft exists', async () => {
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    const source = join(wsDrafts, 'PAN-2858.md');
    writeFileSync(source, '# PRD for PAN-2858\n\nbody\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2858' }),
    );

    expect(result.promoted).toBe(true);
    expect(result.reason).toBe('promoted');
    expect(result.source).toBe(source);
    const canonical = getIssueDraftPath(projectRoot, 'PAN-2858');
    expect(result.path).toBe(canonical);
    expect(readFileSync(canonical, 'utf-8')).toBe('# PRD for PAN-2858\n\nbody\n');
  });

  it('removes the promoted workspace copy so the workspace stays clean', async () => {
    // PAN-3042: the leftover untracked `.pan/drafts/<ISSUE>.md` tripped the
    // spawn-time dirty-workspace gate and stranded the planning→work handoff.
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    const source = join(wsDrafts, 'PAN-3042.md');
    writeFileSync(source, '# PRD for PAN-3042\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-3042' }),
    );

    expect(result.promoted).toBe(true);
    expect(result.sourceRemoved).toBe(true);
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(getIssueDraftPath(projectRoot, 'PAN-3042'), 'utf-8')).toBe('# PRD for PAN-3042\n');
  });

  it('keeps the workspace copy when promotion is skipped for an existing canonical draft', async () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    writeFileSync(join(draftsDir, 'PAN-3042.md'), 'canonical\n', 'utf-8');
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    const source = join(wsDrafts, 'PAN-3042.md');
    writeFileSync(source, 'workspace copy\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-3042' }),
    );

    expect(result.promoted).toBe(false);
    expect(existsSync(source)).toBe(true);
  });

  it('promotes a lowercase-named workspace draft', async () => {
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    writeFileSync(join(wsDrafts, 'pan-2858.md'), 'lower draft\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2858' }),
    );

    expect(result.promoted).toBe(true);
    expect(readFileSync(getIssueDraftPath(projectRoot, 'PAN-2858'), 'utf-8')).toBe('lower draft\n');
  });

  it('never overwrites an existing canonical draft', async () => {
    const draftsDir = getDraftsDir(projectRoot);
    mkdirSync(draftsDir, { recursive: true });
    const canonical = join(draftsDir, 'PAN-2858.md');
    writeFileSync(canonical, 'canonical with operator edits\n', 'utf-8');
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    writeFileSync(join(wsDrafts, 'PAN-2858.md'), 'workspace copy\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2858' }),
    );

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('canonical-exists');
    expect(result.path).toBe(canonical);
    expect(readFileSync(canonical, 'utf-8')).toBe('canonical with operator edits\n');
  });

  it('reports no-workspace-draft when the workspace has no PRD', async () => {
    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot, workspacePath: workspaceRoot, issueId: 'PAN-2858' }),
    );

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('no-workspace-draft');
  });

  /**
   * PAN-4224 WI-4: complete-planning now targets the workspace itself
   * (`projectRoot: workspacePath`), so the PRD lands as a tracked file the
   * issue's own commits carry instead of an untracked file in the primary
   * checkout.
   */
  it('reports canonical-exists when promoting into the workspace and the workspace already holds the draft', async () => {
    const wsDrafts = join(workspaceRoot, '.pan', 'drafts');
    mkdirSync(wsDrafts, { recursive: true });
    const draft = join(wsDrafts, 'PAN-4224.md');
    writeFileSync(draft, '# PRD for PAN-4224\n', 'utf-8');

    const result = await Effect.runPromise(
      promoteWorkspacePrdDraft({ projectRoot: workspaceRoot, workspacePath: workspaceRoot, issueId: 'PAN-4224' }),
    );

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe('canonical-exists');
    expect(existsSync(draft)).toBe(true);
  });

  it('falls back to the primary root draft when neither the target nor the workspace holds one', async () => {
    const primaryRoot = mkdtempSync(join(tmpdir(), 'prd-promote-primary-'));
    try {
      const primaryDraftsDir = getDraftsDir(primaryRoot);
      mkdirSync(primaryDraftsDir, { recursive: true });
      const primaryDraft = join(primaryDraftsDir, 'pan-4224.md');
      writeFileSync(primaryDraft, '# PRD for PAN-4224\n\nfrom the primary checkout\n', 'utf-8');

      const result = await Effect.runPromise(
        promoteWorkspacePrdDraft({
          projectRoot: workspaceRoot,
          workspacePath: workspaceRoot,
          issueId: 'PAN-4224',
          primaryRoot,
        }),
      );

      expect(result).toMatchObject({ promoted: true, reason: 'promoted', source: primaryDraft, sourceRemoved: false });
      const canonical = getIssueDraftPath(workspaceRoot, 'PAN-4224');
      expect(result.path).toBe(canonical);
      expect(readFileSync(canonical, 'utf-8')).toBe('# PRD for PAN-4224\n\nfrom the primary checkout\n');
      expect(existsSync(primaryDraft)).toBe(true);
    } finally {
      rmSync(primaryRoot, { recursive: true, force: true });
    }
  });
});
