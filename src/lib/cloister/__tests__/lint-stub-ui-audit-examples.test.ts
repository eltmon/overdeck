/**
 * End-to-end audit-example fixtures for PAN-1500.
 *
 * These tests lock in the PAN-1454 audit's stated examples (PAN-1389 Files/Comments
 * tabs, PAN-1231 Table/Timeline modes) as regression coverage. They run the real
 * review-context builder against synthetic git workspaces and assert that the
 * resulting manifest and Tier-1 summary flag the stub additions.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReviewContextPromise, formatTier1Summary } from '../review-context.js';

function git(workspace: string, ...args: string[]) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', ...args],
    { cwd: workspace, encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? result.stdout}`);
  }
}

function setupRepo(workspace: string) {
  git(workspace, 'init');
  git(workspace, 'commit', '--allow-empty', '-m', 'initial');
  git(workspace, 'branch', '-M', 'main');
  git(workspace, 'checkout', '-b', 'feature-pan-1500');
}

function commitFile(workspace: string, relPath: string, content: string) {
  const full = join(workspace, relPath);
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  git(workspace, 'add', relPath);
  git(workspace, 'commit', '-m', `add ${relPath}`);
}

describe('PAN-1389 audit example: Files/Comments stub tabs', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-audit-pan-1389-'));
    setupRepo(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('flags both FilesTab and CommentsTab via buildReviewContext end-to-end', async () => {
    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/FilesTab.tsx',
      [
        `export function FilesTab() {`,
        `  const files = useFiles();`,
        `  return <div>{files.length} files</div>;`,
        `}`,
        ``,
        `function useFiles() {`,
        `  return [];`,
        `}`,
      ].join('\n') + '\n',
    );

    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/CommentsTab.tsx',
      [
        `export function CommentsTab() {`,
        `  const comments = useComments();`,
        `  return <div>{comments?.length ?? 0} comments</div>;`,
        `}`,
        ``,
        `function useComments() {`,
        `  return null;`,
        `}`,
      ].join('\n') + '\n',
    );

    const manifest = await buildReviewContextPromise({
      runId: 'audit-pan-1389',
      issueId: 'PAN-1500',
      workspace,
    });

    const filesFinding = manifest.stubUiFindings.find((f) =>
      f.filePath.includes('FilesTab.tsx'),
    );
    const commentsFinding = manifest.stubUiFindings.find((f) =>
      f.filePath.includes('CommentsTab.tsx'),
    );

    expect(filesFinding).toBeDefined();
    expect(commentsFinding).toBeDefined();
    expect(manifest.stubUiFindings.length).toBeGreaterThanOrEqual(2);

    const summary = formatTier1Summary(manifest);
    expect(summary).toContain('FilesTab.tsx');
    expect(summary).toContain('CommentsTab.tsx');
    expect(summary).toContain('Stub UI findings');
  });
});

describe('PAN-1231 audit example: Table/Timeline segmented-control modes', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-audit-pan-1231-'));
    setupRepo(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('flags both TableMode and TimelineMode no-op entries via buildReviewContext end-to-end', async () => {
    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Fleet/FleetAgentsView.tsx',
      [
        `export function FleetAgentsView() {`,
        `  const modes = [`,
        `    { value: 'table', label: 'Table', onChange: () => {} },`,
        `    { value: 'timeline', label: 'Timeline', onChange: () => {} },`,
        `  ];`,
        `  return <SegmentedControl items={modes} />;`,
        `}`,
      ].join('\n') + '\n',
    );

    const manifest = await buildReviewContextPromise({
      runId: 'audit-pan-1231',
      issueId: 'PAN-1500',
      workspace,
    });

    const tableFinding = manifest.stubUiFindings.find(
      (f) => f.filePath.includes('FleetAgentsView.tsx') && f.addedLine.includes('table'),
    );
    const timelineFinding = manifest.stubUiFindings.find(
      (f) => f.filePath.includes('FleetAgentsView.tsx') && f.addedLine.includes('timeline'),
    );

    expect(tableFinding).toBeDefined();
    expect(timelineFinding).toBeDefined();
    expect(manifest.stubUiFindings.length).toBeGreaterThanOrEqual(2);

    const summary = formatTier1Summary(manifest);
    expect(summary).toContain('FleetAgentsView.tsx');
  });
});
