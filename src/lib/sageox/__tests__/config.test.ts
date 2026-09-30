/**
 * PAN-2444 O2: the per-project SageOx upload flag against a real
 * projects.yaml under a temp OVERDECK_HOME.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

const { overdeckHome } = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sageox-config-home-'));
  process.env.OVERDECK_HOME = home;
  return { overdeckHome: home };
});

import { invalidateProjectsConfigCache } from '../../projects.js';
import { listSageoxUploads, readSageoxUpload, SageoxConfigError, setSageoxUpload } from '../config.js';

const projectsPath = join(overdeckHome, 'projects.yaml');

function writeProjects(yaml: string): void {
  writeFileSync(projectsPath, yaml);
  invalidateProjectsConfigCache();
}

beforeEach(() => {
  writeProjects(
    'projects:\n' +
      '  oss:\n    name: OSS\n    path: /tmp/oss\n    issue_prefix: OSS\n    skill_pack_overrides:\n      sageox: true\n' +
      '  work:\n    name: Work\n    path: /tmp/work\n    issue_prefix: WRK\n    sageox_upload: bogus\n',
  );
});

afterAll(() => {
  rmSync(overdeckHome, { recursive: true, force: true });
});

describe('sageox upload flag', () => {
  it('reads unset and unknown values as disabled', async () => {
    expect(await readSageoxUpload('oss')).toBe(false);
    expect(await readSageoxUpload('work')).toBe(false);
    expect(await readSageoxUpload('missing')).toBe(false);
  });

  it('writes enabled and preserves the project\'s other keys', async () => {
    expect(await setSageoxUpload('oss', true)).toEqual({ changed: true });
    invalidateProjectsConfigCache();
    expect(await readSageoxUpload('oss')).toBe(true);
    const written = parseYaml(readFileSync(projectsPath, 'utf8')) as {
      projects: Record<string, Record<string, unknown>>;
    };
    expect(written.projects['oss']).toMatchObject({
      name: 'OSS',
      path: '/tmp/oss',
      issue_prefix: 'OSS',
      skill_pack_overrides: { sageox: true },
      sageox_upload: 'enabled',
    });
    expect(written.projects['work']).toMatchObject({ name: 'Work' });
  });

  it('writes disabled and reports an unchanged value', async () => {
    await setSageoxUpload('oss', true);
    invalidateProjectsConfigCache();
    expect(await setSageoxUpload('oss', true)).toEqual({ changed: false });
    expect(await setSageoxUpload('oss', false)).toEqual({ changed: true });
    invalidateProjectsConfigCache();
    expect(readFileSync(projectsPath, 'utf8')).toContain('sageox_upload: disabled');
    expect(await readSageoxUpload('oss')).toBe(false);
  });

  it('refuses an unknown project', async () => {
    await expect(setSageoxUpload('missing', true)).rejects.toBeInstanceOf(SageoxConfigError);
  });

  it('lists the flag for every project', async () => {
    await setSageoxUpload('work', true);
    invalidateProjectsConfigCache();
    expect(await listSageoxUploads()).toEqual([
      { projectKey: 'oss', upload: false },
      { projectKey: 'work', upload: true },
    ]);
  });
});
