import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { getOllamaInstallGuidance, registerInstallCommand, setupOllamaForInstall } from '../install.js';

function spinner() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
  };
}

describe('pan install Ollama setup', () => {
  it('registers --skip-ollama', () => {
    const program = new Command();
    registerInstallCommand(program);
    expect(program.commands[0].options.some((option) => option.long === '--skip-ollama')).toBe(true);
  });

  it('skips detection when requested', async () => {
    const output = spinner();
    const detectInstalled = vi.fn(async () => true);
    await setupOllamaForInstall({ skip: true, platform: 'linux', spinner: output, detectInstalled });
    expect(detectInstalled).not.toHaveBeenCalled();
    expect(output.info).toHaveBeenCalledWith('Skipping Ollama local-model setup (--skip-ollama)');
  });

  it.each([
    ['linux' as const, 'curl -fsSL https://ollama.com/install.sh | sh'],
    ['darwin' as const, 'brew install ollama'],
  ])('prints %s install guidance when Ollama is absent', async (platform, expected) => {
    const output = spinner();
    await setupOllamaForInstall({
      platform,
      spinner: output,
      detectInstalled: async () => false,
    });
    expect(output.warn).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(getOllamaInstallGuidance(platform)).toContain(expected);
  });

  it('offers and pulls the documented Gemma model when Ollama is installed', async () => {
    const output = spinner();
    const confirmPull = vi.fn(async () => true);
    const pullModel = vi.fn();
    await setupOllamaForInstall({
      platform: 'linux',
      spinner: output,
      detectInstalled: async () => true,
      confirmPull,
      pullModel,
    });
    expect(confirmPull).toHaveBeenCalledWith('gemma4:12b');
    expect(pullModel).toHaveBeenCalledWith('gemma4:12b');
    expect(output.succeed).toHaveBeenLastCalledWith('Pulled gemma4:12b');
  });
});
