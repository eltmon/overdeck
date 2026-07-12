import { describe, expect, it, vi } from 'vitest';

import { ensureProjectBeadsBootstrap, toDoltRemoteUrl } from '../../../../src/lib/beads/bootstrap.js';

describe('beads bootstrap', () => {
  it('normalizes scp-style git remotes', () => {
    expect(toDoltRemoteUrl('git@github.com:eltmon/overdeck.git')).toBe('git+ssh://git@github.com/eltmon/overdeck.git');
  });

  it('bootstraps before wiring the Dolt remote and never migrates locally', async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (file: string, args: readonly string[]) => {
      calls.push(`${file} ${args.join(' ')}`);
      if (file === 'git' && args[0] === 'remote') return 'git@github.com:eltmon/overdeck.git';
      if (file === 'git' && args[0] === 'ls-remote') return `${'a'.repeat(40)}\trefs/dolt/data\n`;
      if (args.join(' ') === 'dolt remote list --json') return '[]';
      return '';
    });
    const result = await ensureProjectBeadsBootstrap('/repo', '/state/.beads', { execute });
    expect(result.remoteRefPresent).toBe(true);
    expect(calls).toContain('bd bootstrap --yes --json');
    expect(calls).toContain('bd dolt remote add origin git+ssh://git@github.com/eltmon/overdeck.git');
    expect(calls.join('\n')).not.toContain('migrate');
  });

  it('blocks a mismatched configured remote', async () => {
    const execute = async (file: string, args: readonly string[]) => {
      if (file === 'git' && args[0] === 'remote') return 'git@github.com:eltmon/overdeck.git';
      if (file === 'git') return '';
      if (args.join(' ') === 'dolt remote list --json') return '[{"name":"origin"}]';
      if (args.join(' ') === 'config get sync.remote') return 'git+ssh://wrong/repo.git';
      return '';
    };
    await expect(ensureProjectBeadsBootstrap('/repo', '/state/.beads', { execute })).rejects.toThrow(/Writes are blocked/);
  });
});
