import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseBeadsCutoverMarker, sha256File, validateBeadsCutoverMarker, writeBeadsCutoverMarker } from '../../../../src/lib/beads/cutover-marker.js';

describe('beads cutover marker', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('validates the report hash and the published refs/dolt/data head', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cutover-marker-'));
    roots.push(root);
    const remote = join(root, 'remote.git');
    const repo = join(root, 'repo');
    execFileSync('git', ['init', '--bare', '-q', remote]);
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    writeFileSync(join(repo, 'seed'), 'seed');
    execFileSync('git', ['add', 'seed'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: repo });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    execFileSync('git', ['push', '-q', remote, `${head}:refs/dolt/data`], { cwd: repo });
    const report = join(root, 'report.md');
    const markerPath = join(root, 'beads-cutover.json');
    writeFileSync(report, '# reviewed\n');
    await writeBeadsCutoverMarker(markerPath, {
      remoteUrl: remote,
      remoteDoltHead: head,
      localReconciledHead: head,
      reconcileReport: { path: 'report.md', sha256: sha256File(report) },
      completedAt: new Date().toISOString(),
    });
    expect((await validateBeadsCutoverMarker(markerPath, repo)).valid).toBe(true);
    writeFileSync(report, '# changed\n');
    expect((await validateBeadsCutoverMarker(markerPath, repo)).reason).toMatch(/SHA-256/);
  });

  it('rejects malformed data', () => {
    expect(parseBeadsCutoverMarker({ remoteUrl: 'x' })).toBeNull();
  });
});
