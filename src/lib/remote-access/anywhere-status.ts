/**
 * The Anywhere status aggregate behind `GET /api/anywhere/status` (PAN-4445
 * FR-7, D-8 to D-11): this machine's identity, the addresses the dashboard
 * trusts, the active paired-device count, the Session Vault state, and the
 * problems the dashboard renders with a fix button.
 *
 * Problems are computed here, on the server, so every client shows the same
 * list. Each carries an `action` the UI maps to a button; a message never
 * tells the operator to run a `pan` command.
 */
import { stat } from 'node:fs/promises';

import { readVaultConfig } from '../vault/config.js';
import { loadVaultKey } from '../vault/identity.js';
import { nextKeyPath } from '../vault/rotate.js';

export type AnywhereVaultState = 'off' | 'locked' | 'rotation-pending' | 'ready';

export type AnywhereAction =
  | { kind: 'pair-dialog' }
  | { kind: 'settings-section'; section: 'session-vault' }
  | { kind: 'none'; docsUrl?: string };

export interface AnywhereProblem {
  code: 'identity-unreadable' | 'no-reachable-address' | 'vault-locked' | 'vault-rotation-pending';
  message: string;
  action: AnywhereAction;
}

export interface AnywhereStatus {
  machine: { environmentId: string; label: string } | null;
  addresses: Array<{ origin: string; loopback: boolean }>;
  devices: { active: number };
  vault: { state: AnywhereVaultState; backend: string | null };
  problems: AnywhereProblem[];
}

const REMOTE_ACCESS_DOCS = 'https://overdeck.ai/configuration/remote-access';
const SESSION_VAULT_DOCS = 'https://overdeck.ai/configuration/session-vault';

/** The backend URL without any user or password it embeds, so the status never echoes a credential. */
function displayBackend(backend: string): string {
  try {
    const url = new URL(backend);
    if (!url.username && !url.password) return backend;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return backend; // scp-style `git@host:path` or a local path
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * The vault state for the status card (D-9 fallback: `src/lib/vault/open.ts`
 * is not on main yet). No backend ⇒ `off`; a `key.next` ⇒ `rotation-pending`;
 * no key ⇒ `locked`; otherwise `ready`. Anything unreadable ⇒ `locked` plus a
 * warning.
 */
export async function readAnywhereVaultState(): Promise<AnywhereStatus['vault']> {
  let backend: string | null = null;
  try {
    const config = await readVaultConfig();
    if (!config.backend) return { state: 'off', backend: null };
    backend = displayBackend(config.backend);
    if (await fileExists(nextKeyPath())) return { state: 'rotation-pending', backend };
    if ((await loadVaultKey()) === null) return { state: 'locked', backend };
    return { state: 'ready', backend };
  } catch (error) {
    console.warn(`[anywhere] vault state unreadable: ${(error as Error).message}`);
    return { state: 'locked', backend };
  }
}

/** The problems to show, in a fixed order. Pure. `[]` when nothing is wrong. */
export function computeAnywhereProblems(input: {
  identityError: string | null;
  addresses: AnywhereStatus['addresses'];
  vault: AnywhereStatus['vault'];
}): AnywhereProblem[] {
  const problems: AnywhereProblem[] = [];
  if (input.identityError !== null) {
    problems.push({
      code: 'identity-unreadable',
      message: `This machine's identity file is unreadable: ${input.identityError}. Other devices cannot tell which machine they reached until it is repaired.`,
      action: { kind: 'none', docsUrl: REMOTE_ACCESS_DOCS },
    });
  }
  if (!input.addresses.some((address) => !address.loopback)) {
    problems.push({
      code: 'no-reachable-address',
      message: 'No address another device can reach is trusted yet. Add one (for example your Tailscale name) to pair a phone or laptop.',
      action: { kind: 'pair-dialog' },
    });
  }
  if (input.vault.state === 'locked') {
    problems.push({
      code: 'vault-locked',
      message: `Session Vault is set up with ${input.vault.backend ?? 'a backend'}, but this machine cannot open it. Unlock it with the vault passphrase or the recovery phrase.`,
      action: { kind: 'settings-section', section: 'session-vault' },
    });
  }
  if (input.vault.state === 'rotation-pending') {
    problems.push({
      code: 'vault-rotation-pending',
      message: 'A vault key rotation started on this machine has not finished. Finish it on this machine before syncing again.',
      action: { kind: 'none', docsUrl: SESSION_VAULT_DOCS },
    });
  }
  return problems;
}
