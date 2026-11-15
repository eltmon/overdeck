import { describe, expect, it } from 'vitest';
import { checkFileManagerIntegration } from '../../../src/cli/commands/doctor-file-manager.js';
import type { FileManagerState } from '../../../src/lib/integrations/file-manager.js';

const STATE: FileManagerState = {
  installed: true,
  platform: 'linux',
  panPath: '/od/cli-bin/pan',
  at: '2026-11-15T00:00:00Z',
  files: ['/h/.local/share/applications/overdeck-open.desktop', '/h/.local/share/nautilus/scripts/Open in Overdeck'],
  registryKeys: [],
};

function deps(present: string[], executable: string[] = ['/od/cli-bin/pan']) {
  return {
    readState: async () => STATE,
    exists: async (path: string) => present.includes(path),
    isExecutable: async (path: string) => executable.includes(path),
  };
}

describe('checkFileManagerIntegration', () => {
  it('returns null with no state file', async () => {
    expect(await checkFileManagerIntegration({ readState: async () => null })).toBeNull();
  });

  it('is ok when pan and every recorded file exist', async () => {
    expect(await checkFileManagerIntegration(deps(STATE.files))).toMatchObject({ name: 'File-manager integration', status: 'ok' });
  });

  it('warns when pan is gone', async () => {
    expect(await checkFileManagerIntegration(deps(STATE.files, []))).toEqual({
      name: 'File-manager integration',
      status: 'warn',
      message: 'File-manager integration is stale: /od/cli-bin/pan',
      fix: 'pan integrate file-manager',
    });
  });

  it('warns naming the first missing recorded file', async () => {
    const result = await checkFileManagerIntegration(deps([STATE.files[0]!]));
    expect(result).toMatchObject({ status: 'warn', fix: 'pan integrate file-manager' });
    expect(result?.message).toBe(`File-manager integration is stale: ${STATE.files[1]}`);
  });
});
