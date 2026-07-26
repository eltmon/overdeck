import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  spawnRun: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
}));

const installerMocks = vi.hoisted(() => ({
  ensureMnemos: vi.fn(),
  ensureOpenKnowledge: vi.fn(),
  startReadOnlyOpenKnowledgeServer: vi.fn(),
}));

const memoryMocks = vi.hoisted(() => ({
  resolveKnowledgeBundleRoot: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  spawnRun: agentMocks.spawnRun,
}));

vi.mock('../../../lib/installers/mnemos.js', () => ({
  ensureMnemos: installerMocks.ensureMnemos,
}));

vi.mock('../../../lib/installers/open-knowledge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/installers/open-knowledge.js')>();
  return {
    ...actual,
    ensureOpenKnowledge: installerMocks.ensureOpenKnowledge,
    startReadOnlyOpenKnowledgeServer: installerMocks.startReadOnlyOpenKnowledgeServer,
  };
});

vi.mock('../../../lib/memory/injection.js', () => ({
  resolveKnowledgeBundleRoot: memoryMocks.resolveKnowledgeBundleRoot,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
}));

import { OpenKnowledgeError, OpenKnowledgeSetupRequiredError } from '../../../lib/installers/open-knowledge.js';
import {
  buildKnowledgePrompt,
  configureKnowledgeCommand,
  knowledgeCommand,
  knowledgeOpenCommand,
} from '../knowledge.js';

describe('knowledgeCommand', () => {
  beforeEach(() => {
    agentMocks.spawnRun.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReset();
    installerMocks.ensureMnemos.mockReset();
    installerMocks.ensureOpenKnowledge.mockReset();
    installerMocks.startReadOnlyOpenKnowledgeServer.mockReset();
    memoryMocks.resolveKnowledgeBundleRoot.mockReset();

    projectMocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/repo/overdeck',
      linearTeam: 'PAN',
    });
    memoryMocks.resolveKnowledgeBundleRoot.mockResolvedValue('/repo/overdeck/knowledge');
    installerMocks.ensureMnemos.mockResolvedValue({
      status: 'already-installed',
      path: '/home/eltmon/.overdeck/bin/mnemos',
    });
    installerMocks.ensureOpenKnowledge.mockResolvedValue({
      status: 'already-installed',
      command: 'ok',
    });
    installerMocks.startReadOnlyOpenKnowledgeServer.mockResolvedValue({
      process: { unref: vi.fn() },
      owned: true,
      reused: false,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    });
    agentMocks.spawnRun.mockResolvedValue({
      id: 'agent-pan-2468-knowledge',
      model: 'claude-opus-4-7',
    });
  });

  it('registers maintenance options and the open subcommand', () => {
    const program = new Command();
    program.name('pan');
    const command = configureKnowledgeCommand(program);
    const help = command.helpInformation();

    expect(help).toContain('Usage: pan knowledge [options] [command] [id]');
    expect(help).toContain('--focus <topic>');
    expect(help).toContain('--retro');
    expect(help).toContain('--model <model>');
    expect(help).toContain('--effort <level>');
    expect(help).toContain('open [options]');
  });

  it('builds the OKF command sequence from focus and retro options', () => {
    const prompt = buildKnowledgePrompt('pan-2468', { focus: 'billing flows', retro: true });

    expect(prompt).toContain('PAN-2468');
    expect(prompt).toContain('`/okf study "billing flows"`');
    expect(prompt).toContain('`/okf retro`');
    expect(prompt).toContain('`/okf sync --topic "billing flows"`');
    expect(prompt).toContain('Do not run `pan done`');
  });

  it('spawns the knowledge role with focus, retro, model, and effort routed through', async () => {
    await knowledgeCommand('pan-2468', {
      focus: 'billing flows',
      retro: true,
      model: 'gpt-5.5',
      effort: 'high',
    });

    expect(projectMocks.resolveProjectFromIssueSync).toHaveBeenCalledWith('PAN-2468');
    expect(memoryMocks.resolveKnowledgeBundleRoot).toHaveBeenCalledWith({ projectPath: '/repo/overdeck' });
    expect(installerMocks.ensureMnemos).toHaveBeenCalledWith({
      bundlePath: '/repo/overdeck/knowledge',
    });
    expect(agentMocks.spawnRun).toHaveBeenCalledWith('PAN-2468', 'knowledge', {
      workspace: '/repo/overdeck',
      model: 'gpt-5.5',
      effort: 'high',
      extraEnvExports: ['export PATH="$HOME/.overdeck/bin:$PATH"'],
      prompt: expect.stringContaining('/okf study "billing flows"'),
      startedBy: 'operator:cli:pan-knowledge',
    });
    expect(agentMocks.spawnRun.mock.calls[0][2].prompt).toContain('/okf retro');
    expect(agentMocks.spawnRun.mock.calls[0][2].prompt).toContain('/okf sync --topic "billing flows"');
  });

  it('throws a clear /okf init error when no knowledge bundle is configured', async () => {
    memoryMocks.resolveKnowledgeBundleRoot.mockResolvedValue(null);

    await expect(knowledgeCommand('pan-2468')).rejects.toThrow(/Run `\/okf init`/);

    expect(agentMocks.spawnRun).not.toHaveBeenCalled();
  });

  it('still spawns when mnemos is unavailable', async () => {
    installerMocks.ensureMnemos.mockRejectedValue(new Error('release fetch failed'));

    await knowledgeCommand('pan-2468');

    expect(installerMocks.ensureMnemos).toHaveBeenCalledWith({
      bundlePath: '/repo/overdeck/knowledge',
    });
    expect(agentMocks.spawnRun).toHaveBeenCalledWith('PAN-2468', 'knowledge', expect.objectContaining({
      workspace: '/repo/overdeck',
      prompt: expect.stringContaining('/okf sync'),
    }));
  });

  it('opens the configured bundle through the resolved command and launches the browser', async () => {
    const unref = vi.fn();
    const ensure = vi.fn(async () => ({
      status: 'already-installed' as const,
      command: '/home/tester/.local/bin/ok',
    }));
    const start = vi.fn(async () => ({
      process: { unref } as never,
      owned: true,
      reused: false,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    }));
    const openBrowser = vi.fn(async () => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await knowledgeOpenCommand({}, {
      cwd: () => '/repo/overdeck',
      ensure,
      start,
      openBrowser,
    });

    expect(memoryMocks.resolveKnowledgeBundleRoot).toHaveBeenCalledWith({ projectPath: '/repo/overdeck' });
    expect(ensure).toHaveBeenCalledWith({ autoInstall: true });
    expect(start).toHaveBeenCalledWith('/repo/overdeck/knowledge', {
      openBrowser: false,
      okCommand: '/home/tester/.local/bin/ok',
    });
    expect(unref).toHaveBeenCalledOnce();
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:39847');
    expect(log).toHaveBeenCalledWith('Knowledge viewer: http://127.0.0.1:39847');
    log.mockRestore();
  });

  it('prints a manager plan, prompts on TTY, executes consented setup, and retries ensure', async () => {
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
    const start = vi.fn(async () => ({
      process: null,
      owned: false,
      reused: true,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    }));
    const prompt = vi.fn(async () => 'y');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await knowledgeOpenCommand({ browser: false }, {
      cwd: () => '/repo/overdeck',
      ensure,
      executeSetupPlan,
      start,
      prompt,
      isTTY: () => true,
    });

    expect(log).toHaveBeenCalledWith(plan.steps[0]);
    expect(prompt).toHaveBeenCalledWith('Proceed? [y/N] ');
    expect(executeSetupPlan).toHaveBeenCalledWith(plan);
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith('/repo/overdeck/knowledge', {
      openBrowser: false,
      okCommand: '/home/tester/.local/bin/ok',
    });
    log.mockRestore();
  });

  it('prints the manual command and exits when setup consent is declined', async () => {
    const plan = {
      kind: 'install-node-via-manager' as const,
      manager: 'fnm' as const,
      installCommand: 'fnm install 24',
      steps: ['Install Node 24 with fnm without changing your default Node.'],
    };
    const ensure = vi.fn().mockRejectedValue(new OpenKnowledgeSetupRequiredError(plan));
    const executeSetupPlan = vi.fn();
    const start = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await knowledgeOpenCommand({ browser: false }, {
      cwd: () => '/repo/overdeck',
      ensure,
      executeSetupPlan,
      start,
      prompt: async () => 'n',
      isTTY: () => true,
    });

    expect(log).toHaveBeenCalledWith('Manual setup: fnm install 24');
    expect(executeSetupPlan).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects with setup steps without prompting on non-TTY stdin', async () => {
    const plan = {
      kind: 'install-nvm' as const,
      steps: ['Install nvm only after reviewing its shell changes.'],
      manualCommand: 'npm install -g @inkeep/open-knowledge',
    };
    const ensure = vi.fn().mockRejectedValue(new OpenKnowledgeSetupRequiredError(plan));
    const prompt = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(knowledgeOpenCommand({ browser: false }, {
      cwd: () => '/repo/overdeck',
      ensure,
      prompt,
      isTTY: () => false,
    })).rejects.toThrow(/Install nvm only after reviewing its shell changes\.[\s\S]*npm install -g @inkeep\/open-knowledge/);
    expect(prompt).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('keeps --no-install strict without prompting or executing setup', async () => {
    const ensure = vi.fn().mockRejectedValue(
      new OpenKnowledgeError('open-knowledge is not installed. Install it manually with `npm install -g @inkeep/open-knowledge`.'),
    );
    const prompt = vi.fn();
    const executeSetupPlan = vi.fn();

    await expect(knowledgeOpenCommand({ install: false, browser: false }, {
      cwd: () => '/repo/overdeck',
      ensure,
      prompt,
      executeSetupPlan,
      isTTY: () => true,
    })).rejects.toThrow('npm install -g @inkeep/open-knowledge');
    expect(ensure).toHaveBeenCalledWith({ autoInstall: false });
    expect(prompt).not.toHaveBeenCalled();
    expect(executeSetupPlan).not.toHaveBeenCalled();
  });

  it('reports and opens the verified URL when the upstream lock is reused', async () => {
    const ensure = vi.fn(async () => ({ status: 'already-installed' as const, command: 'ok' as const }));
    const start = vi.fn(async () => ({
      process: null,
      owned: false,
      reused: true,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    }));
    const openBrowser = vi.fn(async () => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await knowledgeOpenCommand({}, {
      cwd: () => '/repo/overdeck',
      ensure,
      start,
      openBrowser,
    });

    expect(log).toHaveBeenCalledWith('Knowledge viewer: http://127.0.0.1:39847 (reused)');
    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:39847');
    log.mockRestore();
  });

  it('honors --no-install and --no-browser', async () => {
    const unref = vi.fn();
    const ensure = vi.fn(async () => ({ status: 'already-installed' as const, command: 'ok' as const }));
    const start = vi.fn(async () => ({
      process: { unref } as never,
      owned: true,
      reused: false,
      port: 39847,
      apiPort: 8789,
      url: 'http://127.0.0.1:39847',
      runtimeBundlePath: '/runtime/read-only-snapshot',
    }));
    const openBrowser = vi.fn(async () => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await knowledgeOpenCommand({ install: false, browser: false }, {
      cwd: () => '/repo/overdeck',
      ensure,
      start,
      openBrowser,
    });

    expect(ensure).toHaveBeenCalledWith({ autoInstall: false });
    expect(openBrowser).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('rejects with /okf init guidance when open cannot resolve a bundle', async () => {
    memoryMocks.resolveKnowledgeBundleRoot.mockResolvedValue(null);

    await expect(knowledgeOpenCommand({ browser: false }, { cwd: () => '/repo/empty' })).rejects.toThrow(
      'Run `/okf init` first',
    );
    expect(installerMocks.ensureOpenKnowledge).not.toHaveBeenCalled();
  });
});
