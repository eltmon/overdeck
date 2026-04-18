import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

function buildProgram() {
  const program = new Command();
  program.enablePositionalOptions();
  program.exitOverride();
  program.version('0.7.0');

  let captured: string | undefined;

  const release = program.command('release');
  release
    .command('stable')
    .requiredOption('--version <version>')
    .action((options: { version: string }) => {
      captured = options.version;
    });

  return { program, getCaptured: () => captured };
}

describe('release command parsing', () => {
  it('treats --version after the subcommand as the release version option', async () => {
    const { program, getCaptured } = buildProgram();

    await program.parseAsync(['node', 'pan', 'release', 'stable', '--version', '0.7.1'], { from: 'node' });

    expect(getCaptured()).toBe('0.7.1');
  });
});
