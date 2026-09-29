/**
 * PAN-3943 WI-6/WI-7: the managed-mode decision store and Deft launch
 * resolution, against real files under a temp OVERDECK_HOME.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'deft-launch-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { invalidateProjectsConfigCache } from '../../projects.js';
import { disableDeftManaged, enableDeftManaged, readDeftIntegration } from '../project-mode.js';

const projectsPath = join(overdeckHome, 'projects.yaml');
const DIGEST = 'a'.repeat(64);

function writeProjects(text: string): void {
  writeFileSync(projectsPath, text);
  invalidateProjectsConfigCache();
}

function readProjects(): { projects: Record<string, Record<string, unknown>> } {
  return parseYaml(readFileSync(projectsPath, 'utf8'));
}

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('project-mode', () => {
  beforeEach(() => {
    writeProjects(
      'projects:\n' +
        '  tst:\n    name: Test\n    path: /repo/tst\n    issue_prefix: TST\n    skill_pack_overrides:\n      deft: true\n' +
        '  other:\n    name: Other\n    path: /repo/other\n',
    );
  });

  it('reads null when no decision is stored', async () => {
    expect(await readDeftIntegration('tst')).toBeNull();
    expect(await readDeftIntegration('missing')).toBeNull();
  });

  it('round-trips enable and disable without losing unrelated keys', async () => {
    const before = readProjects();
    await enableDeftManaged('tst', DIGEST, new Date('2026-09-29T12:00:00.000Z'));
    invalidateProjectsConfigCache();
    expect(await readDeftIntegration('tst')).toEqual({
      mode: 'managed',
      plan_digest: DIGEST,
      enabled_at: '2026-09-29T12:00:00.000Z',
    });
    const enabled = readProjects();
    expect(enabled.projects['other']).toEqual(before.projects['other']);
    expect(enabled.projects['tst']).toMatchObject({ ...before.projects['tst'] });

    expect(await disableDeftManaged('tst')).toBe(true);
    invalidateProjectsConfigCache();
    expect(readProjects()).toEqual(before);
    expect(await readDeftIntegration('tst')).toBeNull();
    expect(await disableDeftManaged('tst')).toBe(false);
  });

  it('rejects an unknown project and a malformed digest without writing', async () => {
    const before = readFileSync(projectsPath, 'utf8');
    await expect(enableDeftManaged('missing', DIGEST)).rejects.toThrow('unknown project: missing');
    await expect(enableDeftManaged('tst', 'abc')).rejects.toThrow('invalid plan digest');
    expect(readFileSync(projectsPath, 'utf8')).toBe(before);
  });

  it('ignores a malformed stored decision', async () => {
    writeProjects('projects:\n  tst:\n    name: Test\n    path: /repo/tst\n    deft_integration:\n      mode: full\n');
    expect(await readDeftIntegration('tst')).toBeNull();
  });
});
