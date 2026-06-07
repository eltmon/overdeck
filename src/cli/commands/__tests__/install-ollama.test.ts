import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { getOllamaInstallGuidance, registerInstallCommand } from '../install.js';

describe('install command Ollama setup', () => {
  it('registers --skip-ollama', () => {
    const program = new Command();
    registerInstallCommand(program);

    const install = program.commands.find(command => command.name() === 'install');
    expect(install).toBeDefined();
    expect(install!.options.map(option => option.long)).toContain('--skip-ollama');
  });

  it('prints platform-specific Ollama install guidance', () => {
    expect(getOllamaInstallGuidance('darwin')).toContain('brew install --cask ollama');
    expect(getOllamaInstallGuidance('linux')).toContain('curl -fsSL https://ollama.com/install.sh | sh');
  });
});
