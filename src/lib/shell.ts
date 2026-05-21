import { existsSync, readFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Effect } from 'effect';
import { FsError } from './errors.js';

export type Shell = 'bash' | 'zsh' | 'fish' | 'unknown';

export function detectShell(): Effect.Effect<Shell> {
  return Effect.sync(() => {
    const shell = process.env.SHELL || '';
    if (shell.includes('zsh')) return 'zsh';
    if (shell.includes('bash')) return 'bash';
    if (shell.includes('fish')) return 'fish';
    return 'unknown';
  });
}

export function getShellRcFile(shell: Shell): Effect.Effect<string | null> {
  return Effect.sync(() => {
    const home = homedir();
    switch (shell) {
      case 'zsh':
        return join(home, '.zshrc');
      case 'bash': {
        const bashrc = join(home, '.bashrc');
        if (existsSync(bashrc)) return bashrc;
        return join(home, '.bash_profile');
      }
      case 'fish':
        return join(home, '.config', 'fish', 'config.fish');
      default:
        return null;
    }
  });
}

const ALIAS_LINE = 'alias pan="panopticon"';
const ALIAS_MARKER = '# Panopticon CLI alias';

export function hasAlias(rcFile: string): Effect.Effect<boolean, FsError> {
  return Effect.try({
    try: () => {
      if (!existsSync(rcFile)) return false;
      const content = readFileSync(rcFile, 'utf8');
      return content.includes(ALIAS_MARKER) || content.includes(ALIAS_LINE);
    },
    catch: (e) => new FsError({ path: rcFile, operation: 'read', cause: e }),
  });
}

export function addAlias(rcFile: string): Effect.Effect<void, FsError> {
  return Effect.gen(function* () {
    const alreadyHas = yield* hasAlias(rcFile);
    if (alreadyHas) return;

    const aliasBlock = `\n${ALIAS_MARKER}\n${ALIAS_LINE}\n`;

    yield* Effect.try({
      try: () => appendFileSync(rcFile, aliasBlock, 'utf8'),
      catch: (e) => new FsError({ path: rcFile, operation: 'append', cause: e }),
    });
  });
}

export function getAliasInstructions(shell: Shell): Effect.Effect<string> {
  return Effect.gen(function* () {
    const rcFile = yield* getShellRcFile(shell);
    if (!rcFile) {
      return `Add this to your shell config:\n  ${ALIAS_LINE}`;
    }
    return `Alias added to ${rcFile}. Run:\n  source ${rcFile}`;
  });
}
