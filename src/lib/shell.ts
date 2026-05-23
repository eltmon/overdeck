import { Effect } from 'effect';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { FsError } from './errors.js';

export type Shell = 'bash' | 'zsh' | 'fish' | 'unknown';

export function detectShellSync(): Shell {
  const shell = process.env.SHELL || '';

  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('fish')) return 'fish';

  return 'unknown';
}

export function getShellRcFileSync(shell: Shell): string | null {
  const home = homedir();

  switch (shell) {
    case 'zsh':
      return join(home, '.zshrc');
    case 'bash':
      // Prefer .bashrc, fall back to .bash_profile
      const bashrc = join(home, '.bashrc');
      if (existsSync(bashrc)) return bashrc;
      return join(home, '.bash_profile');
    case 'fish':
      return join(home, '.config', 'fish', 'config.fish');
    default:
      return null;
  }
}

const ALIAS_LINE = 'alias pan="panopticon"';
const ALIAS_MARKER = '# Panopticon CLI alias';

export function hasAliasSync(rcFile: string): boolean {
  if (!existsSync(rcFile)) return false;

  const content = readFileSync(rcFile, 'utf8');
  return content.includes(ALIAS_MARKER) || content.includes(ALIAS_LINE);
}

export function addAliasSync(rcFile: string): void {
  if (hasAliasSync(rcFile)) return;

  const aliasBlock = `
${ALIAS_MARKER}
${ALIAS_LINE}
`;

  appendFileSync(rcFile, aliasBlock, 'utf8');
}

export function getAliasInstructionsSync(shell: Shell): string {
  const rcFile = getShellRcFileSync(shell);

  if (!rcFile) {
    return `Add this to your shell config:\n  ${ALIAS_LINE}`;
  }

  return `Alias added to ${rcFile}. Run:\n  source ${rcFile}`;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Shell-detection helpers — pure-sync wrappers and FsError-typed append.

/** Detect the current user's shell from $SHELL. Pure. */
export const detectShell = (): Effect.Effect<Shell> => Effect.sync(() => detectShellSync());

/** Resolve the shell rc file path for a detected shell. Pure-ish (existsSync). */
export const getShellRcFile = (shell: Shell): Effect.Effect<string | null> =>
  Effect.sync(() => getShellRcFileSync(shell));

/** True if the rc file already contains the panopticon alias. Pure-ish (readFile). */
export const hasAlias = (rcFile: string): Effect.Effect<boolean> =>
  Effect.sync(() => hasAliasSync(rcFile));

/** Append the panopticon alias to an rc file; surfaces FsError on failure. */
export const addAlias = (rcFile: string): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => addAliasSync(rcFile),
    catch: (cause) => new FsError({ path: rcFile, operation: 'append-alias', cause }),
  });

/** Human-readable alias install instructions for a shell. Pure. */
export const getAliasInstructions = (shell: Shell): Effect.Effect<string> =>
  Effect.sync(() => getAliasInstructionsSync(shell));
