import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  describeCliGenerationDrift,
  repointGlobalCliToDeployment,
  resolveGlobalCliLinkPath,
} from '../../../../src/lib/deploy/global-cli-link.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;

describe('global CLI generation link (PAN-3538)', () => {
  let home: string;
  let nodePrefix: string;
  let execPath: string;
  let linkPath: string;
  let genA: string;
  let genB: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'overdeck-cli-link-'));
    process.env.OVERDECK_HOME = home;
    nodePrefix = join(home, 'node-prefix');
    execPath = join(nodePrefix, 'bin', 'node');
    await fs.mkdir(join(nodePrefix, 'bin'), { recursive: true });
    await fs.mkdir(join(nodePrefix, 'lib', 'node_modules', '@overdeck'), { recursive: true });
    linkPath = resolveGlobalCliLinkPath(execPath);
    genA = join(home, 'deployments', 'dashboard', '.pan-reload-generation-a');
    genB = join(home, 'deployments', 'dashboard', '.pan-reload-generation-b');
    await fs.mkdir(genA, { recursive: true });
    await fs.mkdir(genB, { recursive: true });
  });

  afterEach(async () => {
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  it('repoints a generation-linked CLI to the new deployment and verifies it', async () => {
    await fs.symlink(genB, linkPath, 'dir');

    const result = await repointGlobalCliToDeployment(genA, { execPath });

    expect(result.status).toBe('repointed');
    expect(await fs.readlink(linkPath)).toBe(genA);
  });

  it('reports already-current without touching a link that matches the target', async () => {
    await fs.symlink(genA, linkPath, 'dir');
    const before = (await fs.lstat(linkPath)).mtimeMs;

    const result = await repointGlobalCliToDeployment(genA, { execPath });

    expect(result.status).toBe('already-current');
    expect((await fs.lstat(linkPath)).mtimeMs).toBe(before);
  });

  it('reports absent when no global link exists', async () => {
    const result = await repointGlobalCliToDeployment(genA, { execPath });

    expect(result.status).toBe('absent');
    await expect(fs.lstat(linkPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never touches a real npm install directory', async () => {
    await fs.mkdir(linkPath, { recursive: true });
    await fs.writeFile(join(linkPath, 'package.json'), '{}');

    const result = await repointGlobalCliToDeployment(genA, { execPath });

    expect(result.status).toBe('foreign');
    expect((await fs.lstat(linkPath)).isDirectory()).toBe(true);
  });

  it('never touches a symlink pointing outside the deployments base (dev npm link)', async () => {
    const repoCheckout = join(home, 'some-repo-checkout');
    await fs.mkdir(repoCheckout, { recursive: true });
    await fs.symlink(repoCheckout, linkPath, 'dir');

    const result = await repointGlobalCliToDeployment(genA, { execPath });

    expect(result.status).toBe('foreign');
    expect(await fs.readlink(linkPath)).toBe(repoCheckout);
  });

  it('surfaces a failed swap as an error instead of silently accepting it', async () => {
    await fs.symlink(genB, linkPath, 'dir');

    const result = await repointGlobalCliToDeployment(genA, {
      execPath,
      rename: async () => {
        throw new Error('EACCES: permission denied');
      },
    });

    expect(result.status).toBe('error');
    expect(await fs.readlink(linkPath)).toBe(genB);
  });

  describe('describeCliGenerationDrift', () => {
    it('flags drift when the CLI and live server run different generations', async () => {
      await fs.symlink(genB, linkPath, 'dir');

      const drift = await describeCliGenerationDrift(genA, { execPath });

      expect(drift.ok).toBe(false);
      expect(drift.message).toContain('stale');
    });

    it('is ok when CLI and server share a generation', async () => {
      await fs.symlink(genA, linkPath, 'dir');

      const drift = await describeCliGenerationDrift(genA, { execPath });

      expect(drift.ok).toBe(true);
    });

    it('is ok (operator-managed) for links outside the deployments base', async () => {
      const repoCheckout = join(home, 'some-repo-checkout');
      await fs.mkdir(repoCheckout, { recursive: true });
      await fs.symlink(repoCheckout, linkPath, 'dir');

      const drift = await describeCliGenerationDrift(genA, { execPath });

      expect(drift.ok).toBe(true);
    });
  });
});
