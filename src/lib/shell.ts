import { existsSync, readFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

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

const ALIAS_LINE = 'alias pan="overdeck"';
const ALIAS_MARKER = '# Overdeck CLI alias';

function hasAliasSync(rcFile: string): boolean {
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
