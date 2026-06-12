import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  getPiLauncherFields: vi.fn(),
  getCodexLauncherFields: vi.fn(),
  piGlobalContextFile: vi.fn(),
  codexGlobalContextFile: vi.fn(),
  ensureSessionContextBriefingFile: vi.fn(),
}));

vi.mock('../../agents.js', async (importActual) => ({
  ...(await importActual<typeof import('../../agents.js')>()),
  getPiLauncherFields: mocks.getPiLauncherFields,
  getCodexLauncherFields: mocks.getCodexLauncherFields,
}));

vi.mock('../../context-layers/index.js', () => ({
  piGlobalContextFile: mocks.piGlobalContextFile,
  codexGlobalContextFile: mocks.codexGlobalContextFile,
}));

vi.mock('../../briefing-freshness.js', () => ({
  ensureSessionContextBriefingFile: mocks.ensureSessionContextBriefingFile,
}));

import { buildPlanningLauncherConfig } from '../spawn-planning-session.js';

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pan-plan-launcher-'));
  await mkdir(join(dir, '.pan', 'context'), { recursive: true });
  return dir;
}

describe('buildPlanningLauncherConfig', () => {
  let workspacePath: string;
  let contextFile: string;
  let briefingFile: string;

  beforeEach(async () => {
    workspacePath = await makeWorkspace();
    contextFile = join(workspacePath, '.pan', 'context', 'workspace.md');
    briefingFile = join(workspacePath, '.pan', 'briefing.md');
    await writeFile(contextFile, '# workspace context', 'utf-8');
    await writeFile(briefingFile, '# briefing', 'utf-8');

    mocks.getPiLauncherFields.mockResolvedValue({
      harness: 'pi',
      piExtensionPath: '/packages/pi-extension/dist/index.js',
      piFifoPath: '/tmp/planning-fifo',
      piSessionDir: '/tmp/planning-session',
      model: 'ollama:gemma4:12b',
    });
    mocks.getCodexLauncherFields.mockReturnValue({
      harness: 'codex',
      codexMode: 'work-tui',
      codexHome: '/tmp/codex-home',
      codexSessionDir: '/tmp/codex-session',
      model: 'gpt-5.5',
    });
    mocks.piGlobalContextFile.mockReturnValue(join(workspacePath, '.pan', 'context', 'pi-global.md'));
    mocks.codexGlobalContextFile.mockReturnValue(join(workspacePath, '.pan', 'context', 'codex-global.md'));
    mocks.ensureSessionContextBriefingFile.mockResolvedValue(briefingFile);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a Claude-shaped config when harness is claude-code', async () => {
    const config = await buildPlanningLauncherConfig({
      effectiveHarness: 'claude-code',
      sessionName: 'planning-pan-999',
      issueIdentifier: 'PAN-999',
      issueTitle: 'Test',
      workspacePath,
      planningModel: 'claude-opus-4-7',
      cmdWithArgs: 'claude --agent roles/plan.md --name planning-pan-999',
      providerExports: 'export ANTHROPIC_BASE_URL=...',
      promptFile: '/tmp/prompt.txt',
      continueFilePath: join(workspacePath, '.pan', 'continue.json'),
    });

    expect(config.harness).toBeUndefined();
    expect(config.piExtensionPath).toBeUndefined();
    expect(config.codexHome).toBeUndefined();
    expect(config.baseCommand).toContain('claude');
  });

  it('returns a full Pi launcher config when harness is pi', async () => {
    const config = await buildPlanningLauncherConfig({
      effectiveHarness: 'pi',
      sessionName: 'planning-pan-999',
      issueIdentifier: 'PAN-999',
      issueTitle: 'Test',
      workspacePath,
      planningModel: 'ollama:gemma4:12b',
      cmdWithArgs: 'pi --mode rpc --model ollama/gemma4:12b',
      providerExports: 'export OPENAI_BASE_URL=http://localhost:11434/v1',
      promptFile: '/tmp/prompt.txt',
      continueFilePath: join(workspacePath, '.pan', 'continue.json'),
    });

    expect(config.harness).toBe('pi');
    expect(config.model).toBe('ollama:gemma4:12b');
    expect(config.piExtensionPath).toBe('/packages/pi-extension/dist/index.js');
    expect(config.piFifoPath).toBe('/tmp/planning-fifo');
    expect(config.piSessionDir).toBe('/tmp/planning-session');
    expect(mocks.getPiLauncherFields).toHaveBeenCalledWith('planning-pan-999', 'ollama:gemma4:12b');
  });

  it('returns a full Codex launcher config when harness is codex', async () => {
    const config = await buildPlanningLauncherConfig({
      effectiveHarness: 'codex',
      sessionName: 'planning-pan-999',
      issueIdentifier: 'PAN-999',
      issueTitle: 'Test',
      workspacePath,
      planningModel: 'gpt-5.5',
      cmdWithArgs: 'codex',
      providerExports: 'export OPENAI_BASE_URL=...',
      promptFile: '/tmp/prompt.txt',
      continueFilePath: join(workspacePath, '.pan', 'continue.json'),
    });

    expect(config.harness).toBe('codex');
    expect(config.model).toBe('gpt-5.5');
    expect(config.codexHome).toBe('/tmp/codex-home');
    expect(config.codexSessionDir).toBe('/tmp/codex-session');
    expect(mocks.getCodexLauncherFields).toHaveBeenCalledWith('planning-pan-999', 'gpt-5.5', workspacePath);
  });

  it('includes the Pi global context file for pi harness when present', async () => {
    const piGlobal = join(workspacePath, '.pan', 'context', 'pi-global.md');
    await writeFile(piGlobal, '# pi global', 'utf-8');

    const config = await buildPlanningLauncherConfig({
      effectiveHarness: 'pi',
      sessionName: 'planning-pan-999',
      issueIdentifier: 'PAN-999',
      issueTitle: 'Test',
      workspacePath,
      planningModel: 'ollama:gemma4:12b',
      cmdWithArgs: 'pi --mode rpc --model ollama/gemma4:12b',
      providerExports: '',
      promptFile: '/tmp/prompt.txt',
      continueFilePath: join(workspacePath, '.pan', 'continue.json'),
    });

    expect(config.appendSystemPromptFiles).toContain(piGlobal);
  });
});
