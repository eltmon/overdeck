/**
 * The dashboard issue-spawn Codex sign-in gate (PAN-4651, scoped in PAN-5633).
 *
 * A GPT model on a ChatGPT subscription signs in through the shared Codex
 * credentials, so an expired or burned Codex sign-in means the spawn would only
 * fail. Every other spawn — a Claude model on an Anthropic subscription
 * included — does not use those credentials and must never be refused here,
 * even while a live Codex session is failing on sign-in.
 */
import type { CodexAuthStatus } from '../codex-auth.js';
import { checkCodexAuthStatus } from '../codex-auth.js';
import { getProviderForModel } from '../providers.js';
import type { AuthMode } from '../subscription-types.js';
import { scanCodexAuthFailures } from './auth-failure-scan.js';

export interface CodexSubscriptionSpawnGateDeps {
  readonly checkStatus?: () => Promise<CodexAuthStatus>;
}

/** True when a spawn of `model` under `authMode` signs in through the shared Codex credentials. */
export function spawnUsesCodexSubscription(model: string, authMode: AuthMode | undefined): boolean {
  return authMode === 'subscription' && getProviderForModel(model).name === 'openai';
}

/**
 * The Codex auth status that blocks this spawn, or null when the spawn may
 * proceed. The live-session scan and status check run only for spawns that use
 * the Codex subscription.
 */
export async function codexSubscriptionSpawnBlock(
  model: string,
  authMode: AuthMode | undefined,
  deps: CodexSubscriptionSpawnGateDeps = {},
): Promise<CodexAuthStatus | null> {
  if (!spawnUsesCodexSubscription(model, authMode)) return null;
  const checkStatus = deps.checkStatus
    ?? (async () => checkCodexAuthStatus({ authFailures: await scanCodexAuthFailures().catch(() => []) }));
  const status = await checkStatus();
  return status.status === 'expired' || status.status === 'burned' ? status : null;
}
