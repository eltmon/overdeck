import { describe, expect, it, vi } from 'vitest';
import { uploadReleaseSourcemaps } from '../../../src/cli/commands/release.js';

describe('release sourcemap upload', () => {
  it('warns and returns without running a command when the API key is absent', () => {
    const run = vi.fn();
    const warn = vi.fn();

    uploadReleaseSourcemaps('/repo', '1.2.3', {
      env: {},
      run,
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      'Warning: POSTHOG_CLI_API_KEY is not set; skipping PostHog sourcemap upload.',
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('injects and uploads the exact built dashboard with release metadata', () => {
    const run = vi.fn();
    const env = {
      POSTHOG_CLI_API_KEY: 'phx_test',
      POSTHOG_CLI_PROJECT_ID: '1234',
    };

    uploadReleaseSourcemaps('/repo', '1.2.3', { env, run });

    const releaseArgs = [
      '--directory',
      '/repo/dist/dashboard/public',
      '--release-name',
      'overdeck-dashboard',
      '--release-version',
      '1.2.3',
    ];
    expect(run).toHaveBeenNthCalledWith(
      1,
      'npx',
      ['posthog-cli', 'sourcemap', 'inject', ...releaseArgs],
      { cwd: '/repo', env },
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      'npx',
      ['posthog-cli', 'sourcemap', 'upload', ...releaseArgs, '--delete-after'],
      { cwd: '/repo', env },
    );
  });
});
