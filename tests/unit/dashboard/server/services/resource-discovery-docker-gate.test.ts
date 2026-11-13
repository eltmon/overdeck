import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

import { resetHostToolsForTests, setHostToolFinderForTests } from '../../../../../src/lib/host-tools.js';
import { loadDockerContainers } from '../../../../../src/dashboard/server/services/resource-discovery-shared.js';

afterEach(() => {
  resetHostToolsForTests();
  mocks.execFile.mockReset();
});

describe('loadDockerContainers host-tools gate (PAN-5168)', () => {
  it('docker missing → returns [] with 0 execFile calls', async () => {
    setHostToolFinderForTests(() => null);

    const result = await loadDockerContainers();

    expect(result).toEqual([]);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('docker present → execFile receives the resolved path', async () => {
    setHostToolFinderForTests(() => '/fake/bin/docker');
    mocks.execFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, out: unknown) => void) => {
        cb(null, { stdout: 'web\napi\n', stderr: '' });
      },
    );

    const result = await loadDockerContainers();

    expect(result).toEqual(['web', 'api']);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0]?.[0]).toBe('/fake/bin/docker');
  });
});
