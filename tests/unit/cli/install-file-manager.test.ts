import { describe, expect, it, vi } from 'vitest';
import { setupFileManagerIntegrationForInstall } from '../../../src/cli/commands/install-file-manager.js';

function spinner() {
  return { info: vi.fn(), warn: vi.fn(), succeed: vi.fn() };
}

describe('setupFileManagerIntegrationForInstall', () => {
  it('with force installs without asking', async () => {
    const confirm = vi.fn(async () => false);
    const install = vi.fn(async () => null);
    const s = spinner();
    await setupFileManagerIntegrationForInstall({ force: true, isTty: true, spinner: s, confirm, install });
    expect(install).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(s.succeed).toHaveBeenCalled();
  });

  it('with skip neither asks nor installs, even with force', async () => {
    const confirm = vi.fn(async () => true);
    const install = vi.fn(async () => null);
    await setupFileManagerIntegrationForInstall({ skip: true, force: true, isTty: true, spinner: spinner(), confirm, install });
    expect(confirm).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('without a TTY and without force skips with an info line', async () => {
    const confirm = vi.fn(async () => true);
    const install = vi.fn(async () => null);
    const s = spinner();
    await setupFileManagerIntegrationForInstall({ isTty: false, spinner: s, confirm, install });
    expect(confirm).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
    expect(s.info).toHaveBeenCalledWith(expect.stringContaining('pan integrate file-manager'));
  });

  it('on a TTY installs once after a yes, and not after a no', async () => {
    const install = vi.fn(async () => null);
    await setupFileManagerIntegrationForInstall({ isTty: true, spinner: spinner(), confirm: async () => true, install });
    expect(install).toHaveBeenCalledTimes(1);
    await setupFileManagerIntegrationForInstall({ isTty: true, spinner: spinner(), confirm: async () => false, install });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('turns an install error or failure message into a warning', async () => {
    const s = spinner();
    await expect(
      setupFileManagerIntegrationForInstall({ force: true, isTty: false, spinner: s, install: async () => { throw new Error('EACCES'); } }),
    ).resolves.toBeUndefined();
    expect(s.warn).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    await setupFileManagerIntegrationForInstall({ force: true, isTty: false, spinner: s, install: async () => 'pan is not installed on PATH. Run: pan sync' });
    expect(s.warn).toHaveBeenLastCalledWith(expect.stringContaining('pan sync'));
  });
});
