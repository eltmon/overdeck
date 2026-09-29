/**
 * Pure Codex per-model client-version floor data (PAN-4363).
 *
 * No imports — this is a leaf module on purpose. `harness-policy.ts` and
 * `system-prerequisites.ts` sit on the CLI startup config chain (PAN-4195's
 * startup guard requires no command-only package, including `ws`, load
 * before a command runs), so they must not pull in `app-server-manager.ts`,
 * whose transport import chain reaches `ws`. `app-server-manager.ts`
 * re-exports these for its existing callers.
 */

/**
 * Oldest Codex CLI OpenAI's backend accepts for each model under ChatGPT
 * sign-in (PAN-4363). Below it the backend answers 400 "The '<model>' model
 * is not supported when using Codex with a ChatGPT account"
 * (openai/codex#47784). 0.156.1 is the first release whose catalog lists
 * both ids. API-key auth has no floor.
 */
export const CODEX_MODEL_MINIMUM_VERSIONS: Readonly<Record<string, string>> = {
  'gpt-6-sol': '0.156.1',
  'gpt-6-luna': '0.156.1',
};

/** Copyable Codex CLI install/upgrade command; Overdeck never runs it. */
export const CODEX_CLI_INSTALL_COMMAND = 'npm install -g @openai/codex';

export function codexModelMinimumVersion(model: string): string | undefined {
  return Object.hasOwn(CODEX_MODEL_MINIMUM_VERSIONS, model) ? CODEX_MODEL_MINIMUM_VERSIONS[model] : undefined;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
