const TRUSTED_GIT_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
] as const;

export function versionShipGitArgs(args: readonly string[]): string[] {
  return ['-c', 'core.hooksPath=/dev/null', ...args];
}

export function versionShipGitEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HUSKY: '0',
  };
  for (const key of TRUSTED_GIT_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
