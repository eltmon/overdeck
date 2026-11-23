import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSpawnWorkspaceCreate } from '../agents/spawn-workspace-create.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSpawnWorkspaceCreate (PAN-5489)', () => {
  it('resolves to the failure message and logs one line naming the issue when the command fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const message = 'Command failed: pan workspace create MIN-1\nHume EVI config setup failed: [hume] API key not found';
    const exec = vi.fn(async () => { throw new Error(message); });

    await expect(runSpawnWorkspaceCreate('MIN-1', '/projects/myn', exec)).resolves.toBe(message);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('MIN-1');
  });

  it('resolves to null, runs the create command in the project, and logs nothing on success', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exec = vi.fn(async (_command: string, _options: unknown) => ({ stdout: '', stderr: '' }));

    await expect(runSpawnWorkspaceCreate('MIN-1', '/projects/myn', exec)).resolves.toBeNull();

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[0]).toBe('pan workspace create MIN-1 --local');
    expect(exec.mock.calls[0]?.[1]).toMatchObject({ cwd: '/projects/myn', timeout: 60000 });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
