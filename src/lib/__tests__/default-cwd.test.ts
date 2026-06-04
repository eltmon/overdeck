import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:os', () => ({ homedir: vi.fn() }));

describe('getDefaultCwd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns ~/Projects when it exists', async () => {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    vi.mocked(homedir).mockReturnValue('/home/test');
    vi.mocked(existsSync).mockReturnValue(true);

    const { getDefaultCwd } = await import('../default-cwd.js');
    expect(getDefaultCwd()).toBe('/home/test/Projects');
    expect(existsSync).toHaveBeenCalledWith('/home/test/Projects');
  });

  it('falls back to $HOME when ~/Projects does not exist', async () => {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    vi.mocked(homedir).mockReturnValue('/home/test');
    vi.mocked(existsSync).mockReturnValue(false);

    const { getDefaultCwd } = await import('../default-cwd.js');
    expect(getDefaultCwd()).toBe('/home/test');
  });
});
