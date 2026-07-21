import { describe, expect, it, vi } from 'vitest';
import { OpenKnowledgeSetupRequiredError } from '../../../../lib/installers/open-knowledge.js';
import { createKnowledgeViewerRouteHandlers } from '../knowledge-viewer.js';

const installedStatus = {
  projectKey: 'overdeck',
  bundleConfigured: true,
  installed: true,
  starting: false,
  running: false,
  bundlePath: '/repo/knowledge',
};

describe('createKnowledgeViewerRouteHandlers', () => {
  it('executes a consented setup plan, retries ensure, invalidates the cache, and returns status', async () => {
    const plan = {
      kind: 'install-node-via-manager' as const,
      manager: 'volta' as const,
      installCommand: 'volta fetch node@24',
      steps: ['Install Node 24 with Volta without changing your default Node.'],
    };
    const ensure = vi.fn()
      .mockRejectedValueOnce(new OpenKnowledgeSetupRequiredError(plan))
      .mockResolvedValueOnce({ status: 'installed', command: '/home/tester/.local/bin/ok' });
    const executeSetupPlan = vi.fn(async () => '/home/tester/.local/bin/ok');
    const invalidateInstallationCache = vi.fn();
    const getStatus = vi.fn(async () => installedStatus);
    const handlers = createKnowledgeViewerRouteHandlers({
      ensure,
      executeSetupPlan,
      invalidateInstallationCache,
      getStatus,
    });

    const result = await handlers.install('overdeck');

    expect(result).toEqual(installedStatus);
    expect(executeSetupPlan).toHaveBeenCalledWith(plan);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(invalidateInstallationCache).toHaveBeenCalledOnce();
    expect(getStatus).toHaveBeenCalledWith('overdeck');
  });

  it('preserves the setup failure detail for the install route error response', async () => {
    const plan = {
      kind: 'install-nvm' as const,
      steps: ['Install nvm after reviewing its shell changes.'],
      manualCommand: 'npm install -g @inkeep/open-knowledge',
    };
    const handlers = createKnowledgeViewerRouteHandlers({
      ensure: vi.fn().mockRejectedValue(new OpenKnowledgeSetupRequiredError(plan)),
      executeSetupPlan: vi.fn().mockRejectedValue(new Error('nvm installer exited with code 7')),
    });

    await expect(handlers.install('overdeck')).rejects.toThrow('nvm installer exited with code 7');
  });
});
