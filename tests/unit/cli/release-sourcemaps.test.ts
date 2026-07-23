import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadReleaseSourcemaps } from '../../../src/cli/commands/release.js';

const tempDirs: string[] = [];

async function createBuiltDashboard(): Promise<{
  repoRoot: string;
  mapPath: string;
  bundlePath: string;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'overdeck-sourcemaps-'));
  tempDirs.push(repoRoot);
  const directory = join(repoRoot, 'dist', 'dashboard', 'public', 'assets');
  await mkdir(directory, { recursive: true });
  const mapPath = join(directory, 'dashboard.js.map');
  const bundlePath = join(directory, 'dashboard.js');
  await writeFile(mapPath, '{}');
  await writeFile(bundlePath, 'console.log("dashboard")');
  return { repoRoot, mapPath, bundlePath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('release sourcemap upload', () => {
  it('warns, removes maps, and skips commands when the API key is absent', async () => {
    const { repoRoot, mapPath, bundlePath } = await createBuiltDashboard();
    const run = vi.fn(async () => undefined);
    const warn = vi.fn();

    await uploadReleaseSourcemaps(repoRoot, '1.2.3', {
      env: {},
      run,
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      'Warning: POSTHOG_CLI_API_KEY is not set; skipping PostHog sourcemap upload.',
    );
    expect(run).not.toHaveBeenCalled();
    await expect(access(mapPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(bundlePath)).resolves.toBeUndefined();
  });

  it('awaits inject and upload for the exact built dashboard release', async () => {
    const { repoRoot, mapPath } = await createBuiltDashboard();
    const run = vi.fn(async () => undefined);
    const env = {
      POSTHOG_CLI_API_KEY: 'phx_test',
      POSTHOG_CLI_PROJECT_ID: '1234',
    };

    await uploadReleaseSourcemaps(repoRoot, '1.2.3', { env, run });

    const releaseArgs = [
      '--directory',
      join(repoRoot, 'dist', 'dashboard', 'public'),
      '--release-name',
      'overdeck-dashboard',
      '--release-version',
      '1.2.3',
    ];
    expect(run).toHaveBeenNthCalledWith(
      1,
      'npx',
      ['posthog-cli', 'sourcemap', 'inject', ...releaseArgs],
      { cwd: repoRoot, env },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      'npx',
      ['posthog-cli', 'sourcemap', 'upload', ...releaseArgs, '--delete-after'],
      { cwd: repoRoot, env },
    );
    await expect(access(mapPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes maps but preserves upload failures', async () => {
    const { repoRoot, mapPath } = await createBuiltDashboard();
    const uploadError = new Error('upload failed');
    const run = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(uploadError);

    await expect(uploadReleaseSourcemaps(repoRoot, '1.2.3', {
      env: { POSTHOG_CLI_API_KEY: 'phx_test' },
      run,
    })).rejects.toBe(uploadError);

    await expect(access(mapPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
