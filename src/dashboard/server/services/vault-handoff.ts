/**
 * Hand off now: settle one managed conversation into the Session Vault
 * immediately (PAN-4455 FR-8).
 *
 * The settle runs through the vault-service queue with WIP mode `force` and
 * reads the record back in the same queue slot (D-6). The result is a
 * `{ status, body }` pair with `body.result` as the discriminator (D-9); a
 * transcript that saved without its code snapshot is still `saved`, carrying
 * `wipProblem` (D-10). Operator messages and fix commands are built here, never
 * imported from `src/cli/` (D-12). The service never logs a body.
 */
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import { getConversationByName, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import type { WipCaptureResult } from '../../../lib/vault/wip-capture.js';
import { settleOnQueue, vaultUnavailableMessage } from './vault-service.js';

export interface VaultHandoffDeps {
  getConversation?: (name: string) => LegacyConversation | null;
  resolvePath?: (conv: LegacyConversation) => Promise<string | null>;
  settle?: typeof settleOnQueue;
  machineLabel?: () => Promise<string>;
}

export type HandOffBody =
  | {
      result: 'saved';
      vaultId: string;
      version: number;
      savedAt: string;
      title: string;
      machineLabel: string;
      logLines: number;
      alreadySaved: boolean;
      forkedFrom: { vaultId: string; version: number } | null;
      wipProblem: { message: string; fix: string | null } | null;
    }
  | { result: 'blocked'; error: string; hits: Array<{ line: number; pattern: string }>; fixes: string[] }
  | { result: 'offline'; error: string; fix: string }
  | { result: 'not-saved'; reason: 'diverged' | 'excluded' | 'empty'; error: string }
  | { result: 'unsupported-harness'; error: string }
  | { result: 'vault-unavailable'; state: 'off' | 'rotation-pending' | 'key-missing' | 'key-mismatch'; error: string }
  | { result: 'not-found'; error: string };

const HANDOFF_HARNESSES = new Set(['claude-code', 'codex']);

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** The code-snapshot problem to report after a saved transcript, or null when there is none (D-10). */
export function wipProblemOf(wip: WipCaptureResult | undefined, vaultId: string): { message: string; fix: string | null } | null {
  if (wip?.status !== 'skipped') return null;
  switch (wip.wip.skipped) {
    case 'secret': {
      const hits = wip.hits ?? [];
      if (hits.length === 0) {
        return { message: `The code snapshot was blocked by the secret scan: ${wip.wip.reason ?? 'secret'}.`, fix: null };
      }
      return {
        message: `The code snapshot was blocked by the secret scan: ${hits.map((hit) => `${hit.file} (${hit.pattern})`).join(', ')}.`,
        fix: [...new Set(hits.map((hit) => hit.file))].map((file) => `pan vault allow-secret ${vaultId.slice(0, 8)} --file ${file}`).join('; '),
      };
    }
    case 'too-large':
      return {
        message: `The code snapshot is ${mb(wip.wip.bytes ?? 0)} MB, over the Session Vault size limit (wipMaxBytes).`,
        fix: 'Commit and push the work, or raise wipMaxBytes in ~/.overdeck/vault/config.json, then click Hand off now again.',
      };
    case 'error':
      return { message: `The code snapshot failed: ${wip.wip.reason ?? 'unknown error'}.`, fix: null };
    case 'clean':
    case 'no-git':
      return null;
  }
}

export async function handOffConversation(name: string, deps: VaultHandoffDeps = {}): Promise<{ status: number; body: HandOffBody }> {
  const getConversation = deps.getConversation ?? getConversationByName;
  const resolvePath = deps.resolvePath ?? resolveSessionFile;
  const settle = deps.settle ?? settleOnQueue;
  const machineLabel = deps.machineLabel ?? (async () => (await ensureEnvironmentIdentity()).label);

  const conv = getConversation(name);
  if (!conv) return { status: 404, body: { result: 'not-found', error: `No conversation named ${name}.` } };

  const harness = conv.harness ?? 'claude-code';
  if (!HANDOFF_HARNESSES.has(harness)) {
    return {
      status: 422,
      body: { result: 'unsupported-harness', error: `Hand-off works for Claude Code and Codex conversations. This conversation runs on ${harness}.` },
    };
  }

  const nativePath = await resolvePath(conv);
  if (!nativePath) return { status: 404, body: { result: 'not-found', error: 'This conversation has no transcript file yet.' } };

  const outcome = await settle(nativePath, harness, 'force', { readBack: true });
  if (outcome.status === 'unavailable') {
    return { status: 409, body: { result: 'vault-unavailable', state: outcome.opened.status, error: vaultUnavailableMessage(outcome.opened) } };
  }

  const { result, record } = outcome;
  switch (result.verdict) {
    case 'blocked':
      return {
        status: 422,
        body: {
          result: 'blocked',
          error: `Not saved: the secret scan blocked ${result.hits.map((hit) => `line ${hit.line} (${hit.pattern})`).join(', ')}.`,
          hits: result.hits.map(({ line, pattern }) => ({ line, pattern })),
          fixes: result.hits.map((hit) => `pan vault allow-secret ${nativePath} ${hit.line}`),
        },
      };
    case 'offline':
      return {
        status: 422,
        body: {
          result: 'offline',
          error: 'Not saved: the vault backend could not be reached. Check the connection and click Hand off now again.',
          fix: `pan vault save ${nativePath}`,
        },
      };
    case 'diverged':
      return { status: 422, body: { result: 'not-saved', reason: 'diverged', error: `Not saved: ${result.reason}.` } };
    case 'excluded':
      return {
        status: 422,
        body: { result: 'not-saved', reason: 'excluded', error: 'Not saved: this conversation matches a Session Vault exclude rule (pan vault exclude).' },
      };
    case 'noop':
    case 'append': {
      if (!record) {
        if (result.verdict === 'noop') {
          return { status: 422, body: { result: 'not-saved', reason: 'empty', error: 'Nothing to save yet: this conversation has no messages.' } };
        }
        throw new Error('The settled record could not be read back.');
      }
      const last = record.settlements.at(-1);
      return {
        status: 200,
        body: {
          result: 'saved',
          vaultId: record.vaultId,
          version: result.verdict === 'append' ? result.version : (record.settlementsArchive?.length ?? 0) + record.settlements.length,
          savedAt: last?.at ?? record.updatedAt,
          title: record.title,
          machineLabel: await machineLabel(),
          logLines: last?.logLines ?? 0,
          alreadySaved: result.verdict === 'noop',
          forkedFrom: result.verdict === 'append' ? (result.forkedFrom ?? null) : null,
          wipProblem: wipProblemOf(result.wip, record.vaultId),
        },
      };
    }
  }
}
