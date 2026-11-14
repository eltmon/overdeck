import { describe, expect, it } from 'vitest';

import { resolveFrontendBuildCommit } from '../vite.config';

describe('frontend bundle build commit (PAN-5236)', () => {
  it('serve → null without calling readHead', async () => {
    let called = false;
    const readHead = async () => {
      called = true;
      return 'abc123';
    };
    await expect(resolveFrontendBuildCommit('serve', readHead)).resolves.toBeNull();
    expect(called).toBe(false);
  });

  it('build with readHead resolving a trimmed commit → that commit', async () => {
    const readHead = async () => 'abc123\n';
    await expect(resolveFrontendBuildCommit('build', readHead)).resolves.toBe('abc123');
  });

  it('build with readHead rejecting → null', async () => {
    const readHead = async () => {
      throw new Error('git failed');
    };
    await expect(resolveFrontendBuildCommit('build', readHead)).resolves.toBeNull();
  });

  it('build with readHead resolving blank → null', async () => {
    const readHead = async () => '  ';
    await expect(resolveFrontendBuildCommit('build', readHead)).resolves.toBeNull();
  });
});
