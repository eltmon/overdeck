import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedConfig } from '../../config-yaml/schema.js';
import {
  assertClaudeCodeSupportsModel,
  evaluateClaudeCodeRequirements,
  formatClaudeCodeTooOldMessage,
  listConfiguredModels,
  minClaudeCodeVersionFor,
} from '../requirements.js';
import {
  claudeCodeUpgradePlan,
  detectClaudeInstall,
  listClaudeBinariesOnPath,
  parseClaudeCodeVersion,
  readClaudeCodeVersion,
  resetClaudeCodeVersionCacheForTests,
  type ClaudeInstall,
} from '../version.js';

type ConfigInput = Pick<NormalizedConfig, 'roles' | 'workhorses' | 'tieredExecution' | 'defaultConversationModel'>;

describe('version', () => {
  afterEach(() => {
    resetClaudeCodeVersionCacheForTests();
  });

  describe('parseClaudeCodeVersion', () => {
    it('extracts the semver from a version banner', () => {
      expect(parseClaudeCodeVersion('2.1.284 (Claude Code)')).toBe('2.1.284');
    });

    it('returns null for garbage', () => {
      expect(parseClaudeCodeVersion('not a version')).toBeNull();
    });
  });

  describe('detectClaudeInstall', () => {
    const home = '/home/u';

    it.each([
      [
        '/home/u/.config/nvm/versions/node/v22.22.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
        'npm',
        '/home/u/.config/nvm/versions/node/v22.22.0',
      ],
      ['/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'npm', '/usr/local'],
      ['/home/u/.local/share/claude/versions/2.1.284', 'native', undefined],
      ['/opt/homebrew/Caskroom/claude-code/2.1.284/claude', 'homebrew', undefined],
      ['/usr/bin/claude', 'unknown', undefined],
    ] as const)('classifies %s as %s', (realPath, method, npmPrefix) => {
      const install = detectClaudeInstall(realPath, home);
      expect(install.method).toBe(method);
      expect(install.npmPrefix).toBe(npmPrefix);
    });
  });

  describe('claudeCodeUpgradePlan', () => {
    it('writable npm install is runnable with a --prefix argv', async () => {
      const install: ClaudeInstall = { method: 'npm', realPath: '/usr/local/x', npmPrefix: '/usr/local' };
      const plan = await claudeCodeUpgradePlan(install, {
        platform: 'linux',
        canWrite: async () => true,
        isExecutable: async () => false,
      });
      expect(plan.runnable).toBe(true);
      expect(plan.argv).toContain('--prefix');
      expect(plan.argv).toContain('/usr/local');
    });

    it('unwritable npm install is not runnable and shows a sudo command', async () => {
      const install: ClaudeInstall = { method: 'npm', realPath: '/usr/local/x', npmPrefix: '/usr/local' };
      const plan = await claudeCodeUpgradePlan(install, {
        platform: 'linux',
        canWrite: async () => false,
        isExecutable: async () => false,
      });
      expect(plan.runnable).toBe(false);
      expect(plan.argv).toBeNull();
      expect(plan.display.startsWith('sudo npm install -g --prefix /usr/local')).toBe(true);
      expect(plan.reason).toBe('not-writable');
    });

    it('win32 is never runnable, regardless of install method', async () => {
      const install: ClaudeInstall = { method: 'native', realPath: 'C:\\claude.exe' };
      const plan = await claudeCodeUpgradePlan(install, { platform: 'win32' });
      expect(plan.runnable).toBe(false);
      expect(plan.argv).toBeNull();
      expect(plan.reason).toBe('unsupported-platform');
    });

    it('native installs run `claude update`', async () => {
      const install: ClaudeInstall = { method: 'native', realPath: '/home/u/.local/share/claude/versions/2.1.284' };
      const plan = await claudeCodeUpgradePlan(install, { platform: 'linux' });
      expect(plan.runnable).toBe(true);
      expect(plan.display).toBe('claude update');
    });

    it('unknown installs are not runnable', async () => {
      const install: ClaudeInstall = { method: 'unknown', realPath: '/usr/bin/claude' };
      const plan = await claudeCodeUpgradePlan(install, { platform: 'linux' });
      expect(plan.runnable).toBe(false);
      expect(plan.reason).toBe('unknown-install');
    });
  });

  describe('readClaudeCodeVersion cache', () => {
    it('shares one exec call within the TTL; refresh and a changed mtime bypass it', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'claude-code-version-test-'));
      const binaryPath = join(dir, 'claude');
      await writeFile(binaryPath, '#!/bin/sh\necho hi\n');

      let calls = 0;
      const exec = async () => {
        calls += 1;
        return { stdout: '2.1.284 (Claude Code)', stderr: '' };
      };

      const first = await readClaudeCodeVersion(binaryPath, { exec });
      const second = await readClaudeCodeVersion(binaryPath, { exec });
      expect(first).toBe('2.1.284');
      expect(second).toBe('2.1.284');
      expect(calls).toBe(1);

      await readClaudeCodeVersion(binaryPath, { exec, refresh: true });
      expect(calls).toBe(2);

      const future = new Date(Date.now() + 5000);
      await utimes(binaryPath, future, future);
      await readClaudeCodeVersion(binaryPath, { exec });
      expect(calls).toBe(3);
    });

    it('resolves to null when the exec fails', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'claude-code-version-test-'));
      const binaryPath = join(dir, 'claude');
      await writeFile(binaryPath, '#!/bin/sh\necho hi\n');

      const version = await readClaudeCodeVersion(binaryPath, {
        exec: async () => {
          throw new Error('ENOENT');
        },
      });
      expect(version).toBeNull();
    });
  });

  describe('listClaudeBinariesOnPath', () => {
    it('keeps executable claude binaries, in PATH order, deduped by real path', async () => {
      const executables = new Set(['/a/claude', '/b/claude']);
      const realPaths = new Map([
        ['/a/claude', '/real/claude'],
        ['/b/claude', '/real/claude'],
      ]);

      const result = await listClaudeBinariesOnPath('/a:/b:/c', {
        access: async (path) => {
          if (!executables.has(path)) throw new Error('EACCES');
        },
        realpath: async (path) => realPaths.get(path) ?? path,
      });

      expect(result).toEqual([{ path: '/a/claude', realPath: '/real/claude' }]);
    });
  });
});

describe('requirements', () => {
  describe('minClaudeCodeVersionFor', () => {
    it('returns the documented minimum for a model id', () => {
      expect(minClaudeCodeVersionFor('claude-sonnet-5-5')).toBe('2.1.284');
    });

    it('strips a trailing context-window suffix before resolving', () => {
      expect(minClaudeCodeVersionFor('claude-sonnet-5-5[1m]')).toBe('2.1.284');
    });

    it('returns undefined for an unknown model id', () => {
      expect(minClaudeCodeVersionFor('not-a-real-model')).toBeUndefined();
    });
  });

  describe('listConfiguredModels', () => {
    it('walks weighted role models, sub-roles, workhorses, and enabled tiers, with sources', () => {
      const config = {
        workhorses: { mid: 'claude-sonnet-5-5' },
        roles: {
          work: {
            model: [
              { model: 'claude-sonnet-5-5', weight: 70 },
              { model: 'workhorse:mid', weight: 30 },
            ],
            sub: {
              parent: { model: 'parent' },
              security: { model: 'claude-fable-5-1' },
            },
          },
        },
        tieredExecution: {
          enabled: true,
          tiers: { quick: { model: 'claude-haiku-4-5', harness: 'claude-code', difficulties: [] } },
          difficultyToTier: {},
          byKind: {},
        },
        defaultConversationModel: 'claude-opus-4-7',
      } as never as ConfigInput;

      const models = listConfiguredModels(config);
      const byModel = new Map(models.map((m) => [m.model, m.sources]));

      expect(byModel.get('claude-sonnet-5-5')).toEqual(expect.arrayContaining(['roles.work.model', 'workhorses.mid']));
      expect(byModel.get('claude-fable-5-1')).toEqual(['roles.work.sub.security.model']);
      expect(byModel.get('claude-haiku-4-5')).toEqual(['tieredExecution.tiers.quick.model']);
      expect(byModel.get('claude-opus-4-7')).toEqual(['models.default_conversation_model']);
      expect(byModel.has('parent')).toBe(false);
    });
  });

  describe('evaluateClaudeCodeRequirements', () => {
    it('marks a too-old install unsatisfied and a met minimum satisfied', () => {
      const models = [
        { model: 'claude-sonnet-5-5', sources: ['roles.work.model'] },
        { model: 'claude-fable-5-1', sources: ['roles.plan.model'] },
      ];
      const requirements = evaluateClaudeCodeRequirements('2.1.280', models);
      const byModel = new Map(requirements.map((r) => [r.model, r.satisfied]));
      expect(byModel.get('claude-sonnet-5-5')).toBe(false);
      expect(byModel.get('claude-fable-5-1')).toBe(true);
    });

    it('is null (unknown) when the installed version could not be read', () => {
      const requirements = evaluateClaudeCodeRequirements(null, [{ model: 'claude-sonnet-5-5', sources: [] }]);
      expect(requirements[0]?.satisfied).toBeNull();
    });
  });

  describe('formatClaudeCodeTooOldMessage', () => {
    it('names both versions, the binary path, and the upgrade command', () => {
      const message = formatClaudeCodeTooOldMessage({
        model: 'claude-sonnet-5-5',
        displayName: 'Claude Sonnet 5.5',
        installed: '2.1.280',
        required: '2.1.284',
        binaryPath: '/usr/local/bin/claude',
        upgradeCommand: 'npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
      });
      expect(message).toContain('2.1.284');
      expect(message).toContain('2.1.280');
      expect(message).toContain('/usr/local/bin/claude');
      expect(message).toContain('npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest');
      expect(message).toContain('No terminal session was created.');
    });
  });

  describe('assertClaudeCodeSupportsModel', () => {
    it('returns without throwing when the version cannot be read, and warns once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(
        assertClaudeCodeSupportsModel('/usr/local/bin/claude', 'claude-sonnet-5-5', {
          readVersion: async () => null,
        }),
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('returns without throwing when there is no model', async () => {
      await expect(assertClaudeCodeSupportsModel('/usr/local/bin/claude', undefined)).resolves.toBeUndefined();
    });

    it('throws ClaudeCodeTooOldError when the installed version is older than the minimum', async () => {
      await expect(
        assertClaudeCodeSupportsModel('/usr/local/bin/claude', 'claude-sonnet-5-5', {
          readVersion: async () => '2.1.280',
          detectInstall: () => ({ method: 'npm', realPath: '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', npmPrefix: '/usr/local' }),
          upgradePlan: async () => ({
            method: 'npm',
            argv: ['npm', 'install', '-g', '--prefix', '/usr/local', '@anthropic-ai/claude-code@latest'],
            display: 'npm install -g --prefix /usr/local @anthropic-ai/claude-code@latest',
            runnable: true,
          }),
          resolveRealPath: async (p) => p,
        }),
      ).rejects.toMatchObject({
        name: 'ClaudeCodeTooOldError',
        model: 'claude-sonnet-5-5',
        installed: '2.1.280',
        required: '2.1.284',
      });
    });
  });
});
