import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { BEADS_GITIGNORE_POLICY, standardizeBeadsConfig } from '../../../../src/lib/beads/config-standardize.js';

describe('beads config standardization', () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  it('removes no-db and installs the complete Dolt runtime ignore policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beads-config-'));
    roots.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:eltmon/project.git'], { cwd: root });
    mkdirSync(join(root, '.beads'));
    writeFileSync(join(root, '.beads', 'config.yaml'), 'no-db: true\nsync.remote: git+ssh://git@github.com/eltmon/project.git\n');
    const result = await standardizeBeadsConfig(root);
    expect(result).toMatchObject({ removedNoDb: true, remoteMatches: true });
    expect(readFileSync(join(root, '.beads', 'config.yaml'), 'utf8')).not.toContain('no-db');
    const projectIgnore = readFileSync(join(root, '.gitignore'), 'utf8');
    const beadsIgnore = readFileSync(join(root, '.beads', '.gitignore'), 'utf8');
    for (const line of BEADS_GITIGNORE_POLICY.project) expect(projectIgnore).toContain(line);
    for (const line of BEADS_GITIGNORE_POLICY.beads) expect(beadsIgnore).toContain(line);
  });
});
