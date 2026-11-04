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
import type { TailscaleNextStep } from '../tailscale/state.js';
import { readVaultConfig } from '../vault/config.js';
import { openVaultContext } from '../vault/open.js';

export type AnywhereVaultState = 'off' | 'locked' | 'rotation-pending' | 'ready';

export type AnywhereAction =
  | { kind: 'pair-dialog' }
  | { kind: 'settings-section'; section: 'session-vault' }
  | { kind: 'tailscale-setup' }
  | { kind: 'none'; docsUrl?: string };

export interface AnywhereProblem {
  code: 'identity-unreadable' | 'no-reachable-address' | 'vault-locked' | 'vault-rotation-pending' | 'tailscale-serve-unprotected';
  message: string;
  action: AnywhereAction;
}

/**
 * PAN-4645: `machine` is a linked machine reading the status over its secure
 * channel. PAN-4835: `phone` is the phone app reading it the same way.
 * PAN-4927 D-17: `connector` is an Overdeck connector reading it the same way.
 */
export type AnywhereViewerKind = 'root-session' | 'device' | 'token' | 'internal-token' | 'machine' | 'phone' | 'connector';

export interface AnywhereStatus {
  machine: { environmentId: string; label: string } | null;
  addresses: Array<{ origin: string; loopback: boolean }>;
  devices: { active: number };
  vault: { state: AnywhereVaultState; backend: string | null };
  /** PAN-4645 D-4645-12: the enforced `require_token_mint`, the YAML value, and why it is on by itself. */
  tokenMint: { effective: boolean; configured: boolean; autoReasons: string[] };
  problems: AnywhereProblem[];
  /** Tailscale on this machine (PAN-1254 FR-9); `not-installed` when no CLI resolves. */
  tailscale: { nextStep: TailscaleNextStep | 'not-installed'; serveUrl: string | null; magicDnsName: string | null };
  /** Who is asking (PAN-4455 D-3); null when no credential resolves (a loopback peer with no session). */
  viewer: { kind: AnywhereViewerKind | null };
  /** The overdeck.ai directory (PAN-2356); null when this machine is signed out or runs no directory client. */
  directory: AnywhereDirectoryStatus | null;
  /** The relay add-on (PAN-2356 FR-21); null when the plan has no relay or there is no directory. */
  relay: AnywhereRelayStatus | null;
}

export interface AnywhereDirectoryStatus {
  state: 'off' | 'connecting' | 'online' | 'refused';
  plan: 'free' | 'tester' | null;
  url: string | null;
  refusal: string | null;
}

export interface AnywhereRelayStatus {
  /** A relay channel is open now. */
  using: boolean;
  bytesUsed: number;
  capBytes: number;
  stopped: boolean;
}

type Source<T> = () => T | null;

let directorySource: Source<AnywhereDirectoryStatus> = () => null;
let relaySource: Source<AnywhereRelayStatus> = () => null;

/** The dashboard registers the directory client here, so this module never imports the server. */
export function setDirectoryStatusSource(source: Source<AnywhereDirectoryStatus> | null): void {
  directorySource = source ?? (() => null);
}

/** The dashboard registers the relay client here. */
export function setRelayStatusSource(source: Source<AnywhereRelayStatus> | null): void {
  relaySource = source ?? (() => null);
}

export function readDirectoryStatus(): AnywhereDirectoryStatus | null {
  return directorySource();
}

export function readRelayStatus(): AnywhereRelayStatus | null {
  return relaySource();
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

/**
 * The vault state for the status card (PAN-4445 D-9: `openVaultContext()`,
 * the same resolution `GET /api/vault/status` uses). `off → off`,
 * `key-missing | key-mismatch → locked`, `rotation-pending → rotation-pending`,
 * `open → ready`. Anything unreadable ⇒ `locked` plus a warning.
 */
export async function readAnywhereVaultState(): Promise<AnywhereStatus['vault']> {
  let backend: string | null = null;
  try {
    // Read first so an error opening the store still reports the backend.
    const config = await readVaultConfig();
    backend = config.backend ? displayBackend(config.backend) : null;
    const opened = await openVaultContext();
    switch (opened.status) {
      case 'off':
        return { state: 'off', backend: null };
      case 'rotation-pending':
        return { state: 'rotation-pending', backend: displayBackend(opened.backend) };
      case 'key-missing':
      case 'key-mismatch':
        return { state: 'locked', backend: displayBackend(opened.backend) };
      case 'open':
        return { state: 'ready', backend };
    }
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
  /** Tailscale Serve proxies this dashboard (PAN-1254). */
  tailscaleServeOn?: boolean;
  /** `dashboard.require_token_mint`. */
  requireTokenMint?: boolean;
}): AnywhereProblem[] {
  const problems: AnywhereProblem[] = [];
  // Serve makes every tailnet visitor a loopback peer, and a loopback peer may
  // mint the root session unless a token is required (PAN-1254 D-2).
  if (input.tailscaleServeOn === true && input.requireTokenMint !== true) {
    problems.push({
      code: 'tailscale-serve-unprotected',
      message: 'Tailscale Serve sends tailnet visitors to this dashboard, but a token is not required to sign in. Anyone on your tailnet could open it.',
      action: { kind: 'tailscale-setup' },
    });
  }
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
