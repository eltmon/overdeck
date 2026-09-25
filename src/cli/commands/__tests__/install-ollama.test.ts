import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getOllamaInstallGuidance, setupOllamaForInstall } from '../install-ollama.js';

function makeSpinner() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
  };
}

function allMessages(spinner: ReturnType<typeof makeSpinner>): string {
  return Object.values(spinner)
    .flatMap((fn) => fn.mock.calls.map((call) => String(call[0])))
    .join('\n');
}

describe('getOllamaInstallGuidance', () => {
  it('names the right installer per platform and never runs one', () => {
    expect(getOllamaInstallGuidance('darwin')).toContain('brew install ollama');
    expect(getOllamaInstallGuidance('linux')).toContain('https://ollama.com/install.sh');
    expect(getOllamaInstallGuidance('wsl')).toContain('https://ollama.com/install.sh');
    expect(getOllamaInstallGuidance('win32')).toContain('ollama.com/download/windows');
  });
});

describe('setupOllamaForInstall', () => {
  let spinner: ReturnType<typeof makeSpinner>;
  let detectInstalled: ReturnType<typeof vi.fn>;
  let confirmPull: ReturnType<typeof vi.fn>;
  let pullModel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spinner = makeSpinner();
    detectInstalled = vi.fn(async () => true);
    confirmPull = vi.fn(async () => true);
    pullModel = vi.fn();
  });

  it('does nothing but say so when --skip-ollama is passed', async () => {
    await setupOllamaForInstall({
      skip: true,
      platform: 'linux',
      spinner,
      isTty: true,
      detectInstalled,
      confirmPull,
      pullModel,
    });

    expect(spinner.info).toHaveBeenCalledWith(expect.stringContaining('--skip-ollama'));
    expect(detectInstalled).not.toHaveBeenCalled();
    expect(pullModel).not.toHaveBeenCalled();
  });

  it('prints platform guidance and never pulls when Ollama is missing', async () => {
    detectInstalled.mockResolvedValue(false);

    await setupOllamaForInstall({
      platform: 'darwin',
      spinner,
      isTty: true,
      detectInstalled,
      confirmPull,
      pullModel,
    });

    expect(spinner.warn).toHaveBeenCalledWith(expect.stringContaining('brew install ollama'));
    expect(confirmPull).not.toHaveBeenCalled();
    expect(pullModel).not.toHaveBeenCalled();
  });

  it('pulls gemma4:12b when an operator on a TTY confirms', async () => {
    await setupOllamaForInstall({
      platform: 'linux',
      spinner,
      isTty: true,
      detectInstalled,
      confirmPull,
      pullModel,
    });

    expect(confirmPull).toHaveBeenCalledWith('gemma4:12b');
    expect(pullModel).toHaveBeenCalledWith('gemma4:12b');
    expect(spinner.succeed).toHaveBeenCalledWith('Pulled gemma4:12b');
  });

  it('does not pull when the operator declines', async () => {
    confirmPull.mockResolvedValue(false);

    await setupOllamaForInstall({
      platform: 'linux',
      spinner,
      isTty: true,
      detectInstalled,
      confirmPull,
      pullModel,
    });

    expect(pullModel).not.toHaveBeenCalled();
    expect(allMessages(spinner)).toContain('ollama pull gemma4:12b');
  });

  it('never prompts without a TTY; it prints the command instead', async () => {
    await setupOllamaForInstall({
      platform: 'linux',
      spinner,
      isTty: false,
      detectInstalled,
      confirmPull,
      pullModel,
    });

    expect(confirmPull).not.toHaveBeenCalled();
    expect(pullModel).not.toHaveBeenCalled();
    expect(spinner.info).toHaveBeenCalledWith(expect.stringContaining('ollama pull gemma4:12b'));
  });

  it('treats a failed pull as a warning, not an install failure', async () => {
    pullModel.mockImplementation(() => { throw new Error('network down'); });

    await expect(setupOllamaForInstall({
      platform: 'linux',
      spinner,
      isTty: true,
      detectInstalled,
      confirmPull,
      pullModel,
    })).resolves.toBeUndefined();

    expect(spinner.warn).toHaveBeenCalledWith(expect.stringContaining('Could not pull gemma4:12b'));
  });
});
