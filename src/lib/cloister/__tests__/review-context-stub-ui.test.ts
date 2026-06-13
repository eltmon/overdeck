/**
 * Integration tests for stub-UI wiring into the review context manifest
 * (PAN-1500, review-context-wire bead).
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReviewContextPromise, formatTier1Summary } from '../review-context.js';

function git(workspace: string, ...args: string[]) {
  const result = spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', ...args], {
    cwd: workspace,
    encoding: 'utf-8',
  });
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

describe('buildReviewContext stubUiFindings integration', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-review-context-'));
    setupRepo(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('includes non-empty stubUiFindings and summary section for a PAN-1389-style stub', async () => {
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

    const manifest = await buildReviewContextPromise({
      runId: 'test-run',
      issueId: 'PAN-STUB-TEST',
      workspace,
    });

    expect(manifest.stubUiFindings.length).toBeGreaterThan(0);
    expect(manifest.stubUiFindings[0]).toMatchObject({
      patternId: expect.any(String),
      patternLabel: expect.any(String),
      filePath: expect.stringContaining('FilesTab.tsx'),
      lineNumber: expect.any(Number),
      addedLine: expect.any(String),
      severity: expect.any(String),
    });

    const summary = formatTier1Summary(manifest);
    expect(summary).toContain('Stub UI findings');
    expect(summary).toContain('FilesTab.tsx');
  });

  it('omits the Stub UI section when no stubs are present', async () => {
    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/RealTab.tsx',
      [
        `export function RealTab() {`,
        `  const { data } = useFetch('/api/items');`,
        `  if (!data) return <div>Loading…</div>;`,
        `  return <div>{data.map((item: { id: string; name: string }) => <span key={item.id}>{item.name}</span>)}</div>;`,
        `}`,
      ].join('\n') + '\n',
    );

    const manifest = await buildReviewContextPromise({
      runId: 'test-run',
      issueId: 'PAN-STUB-TEST',
      workspace,
    });

    expect(manifest.stubUiFindings).toEqual([]);
    const summary = formatTier1Summary(manifest);
    expect(summary).not.toContain('Stub UI findings');
  });
});
