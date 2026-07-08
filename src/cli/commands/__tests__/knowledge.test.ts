import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const agentMocks = vi.hoisted(() => ({
  spawnRun: vi.fn(),
}));

const projectMocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  loadProjectsConfigSync: vi.fn(),
}));

const installerMocks = vi.hoisted(() => ({
  ensureMnemos: vi.fn(),
}));

vi.mock('../../../lib/agents.js', () => ({
  spawnRun: agentMocks.spawnRun,
}));

vi.mock('../../../lib/installers/mnemos.js', () => ({
  ensureMnemos: installerMocks.ensureMnemos,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: projectMocks.resolveProjectFromIssueSync,
  loadProjectsConfigSync: projectMocks.loadProjectsConfigSync,
}));

import { buildKnowledgePrompt, configureKnowledgeCommand, knowledgeCommand } from '../knowledge.js';

describe('knowledgeCommand', () => {
  beforeEach(() => {
    agentMocks.spawnRun.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReset();
    projectMocks.loadProjectsConfigSync.mockReset();
    installerMocks.ensureMnemos.mockReset();
    projectMocks.resolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/repo/overdeck',
      linearTeam: 'PAN',
    });
    projectMocks.loadProjectsConfigSync.mockReturnValue({
      projects: {
        overdeck: {
          name: 'Overdeck',
          path: '/repo/overdeck',
          knowledge_repo: 'knowledge',
        },
      },
    });
    installerMocks.ensureMnemos.mockResolvedValue({
      status: 'already-installed',
      path: '/home/eltmon/.overdeck/bin/mnemos',
    });
    agentMocks.spawnRun.mockResolvedValue({
      id: 'agent-pan-2468-knowledge',
      model: 'claude-opus-4-7',
    });
  });

  it('registers help with id, focus, retro, model, and effort', () => {
    const program = new Command();
    program.name('pan');
    const command = configureKnowledgeCommand(program);

    expect(command.helpInformation()).toMatchInlineSnapshot(`
      "Usage: pan knowledge [options] <id>

      Spawn a knowledge agent to maintain the project OKF bundle

      Options:
        --focus <topic>   Run /okf study for a focused topic before syncing
        --retro           Run /okf retro before syncing
        --model <model>   Model override (defaults to roles.knowledge.model from
                          config)
        --effort <level>  Knowledge effort: low | medium | high | xhigh | max
        -h, --help        display help for command
      "
    `);
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
    expect(installerMocks.ensureMnemos).toHaveBeenCalledWith({
      bundlePath: '/repo/overdeck/knowledge',
    });
    expect(agentMocks.spawnRun).toHaveBeenCalledWith('PAN-2468', 'knowledge', {
      workspace: '/repo/overdeck',
      model: 'gpt-5.5',
      effort: 'high',
      extraEnvExports: ['export PATH="$HOME/.overdeck/bin:$PATH"'],
      prompt: expect.stringContaining('/okf study "billing flows"'),
    });
    expect(agentMocks.spawnRun.mock.calls[0][2].prompt).toContain('/okf retro');
    expect(agentMocks.spawnRun.mock.calls[0][2].prompt).toContain('/okf sync --topic "billing flows"');
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
});
