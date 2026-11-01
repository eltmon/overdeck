/**
 * Tailscale install plan (PAN-1254 W-2, FR-2, D-9, NFR-1).
 *
 * Decides how this machine gets Tailscale: a command the operator runs in a
 * pane (where they type any `sudo` password themselves), the Overdeck
 * userspace install, or a manual instruction with a link. Commands are only
 * strings here; nothing is elevated or executed.
 */
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { delimiter, join } from 'node:path';
import { Effect } from 'effect';
import { detectPlatform, type Platform } from '../platform.js';
import { dashboardApiPort } from './state.js';

export type InstallPlan =
  | { kind: 'pane'; command: string }
  | { kind: 'userspace' }
  | { kind: 'manual'; message: string; url: string; command?: string };

export interface InstallPlanInput {
  platform: Platform;
  uid: number | null;
  username: string;
  hasSudo: boolean;
  hasBrew: boolean;
  userspace: boolean;
  port: number;
  /** Defaults to {@link USERSPACE_MODE_AVAILABLE}. */
  userspaceAvailable?: boolean;
}

export const LINUX_INSTALL_COMMAND = 'curl -fsSL https://tailscale.com/install.sh | sh';

/**
 * Whether the plan offers the userspace install (`src/lib/tailscale/userspace.ts`).
 * Off under the PRD's C-1 fallback: whether other tailnet devices can reach a
 * userspace-networking dashboard (plain tailnet IP and Serve HTTPS) has not
 * been checked live on a signed-in tailnet. Turn it on only after that check
 * passes; the install code itself is complete and tested.
 */
export const USERSPACE_MODE_AVAILABLE = false;

/** POSIX user names only, so the name is safe to place in a shell command. */
const USERNAME_PATTERN = /^[a-z_][a-z0-9_.-]*\$?$/i;

/** `sudo tailscale set --operator=<user>`, or null when the name is not a safe POSIX user name. */
export function operatorCommand(username: string): string | null {
  return USERNAME_PATTERN.test(username) ? `sudo tailscale set --operator=${username}` : null;
}

/** The D-9 table. Pure. */
export function installPlan(input: InstallPlanInput): InstallPlan {
  switch (input.platform) {
    case 'linux': {
      if (input.uid === 0) return { kind: 'pane', command: LINUX_INSTALL_COMMAND };
      const userspaceAvailable = input.userspaceAvailable ?? USERSPACE_MODE_AVAILABLE;
      if (userspaceAvailable && (!input.hasSudo || input.userspace)) return { kind: 'userspace' };
      if (!input.hasSudo) {
        return {
          kind: 'manual',
          message: 'Tailscale needs an administrator to install it on Linux. Run the installer as root (or ask an administrator), make your user the Tailscale operator with `tailscale set --operator=$USER`, then press Check again.',
          url: 'https://tailscale.com/download/linux',
          command: LINUX_INSTALL_COMMAND,
        };
      }
      const operator = operatorCommand(input.username);
      if (!operator) {
        return {
          kind: 'manual',
          message: 'Run the Tailscale installer in your terminal, then make your user the Tailscale operator with `sudo tailscale set --operator=$USER`, then press Check again.',
          url: 'https://tailscale.com/download/linux',
          command: LINUX_INSTALL_COMMAND,
        };
      }
      return { kind: 'pane', command: `${LINUX_INSTALL_COMMAND} && ${operator}` };
    }
    case 'darwin':
      if (input.hasBrew) return { kind: 'pane', command: 'brew install --cask tailscale-app && open -a Tailscale' };
      return {
        kind: 'manual',
        message: 'Download and open the Tailscale package, open Tailscale, allow its VPN configuration, then press Check again.',
        url: 'https://pkgs.tailscale.com/stable/#macos',
      };
    case 'wsl':
      return {
        kind: 'manual',
        message: `Install Tailscale on Windows (not inside WSL). Then run \`tailscale serve --bg --https=443 http://127.0.0.1:${input.port}\` in Windows PowerShell.`,
        url: 'https://tailscale.com/download/windows',
      };
    case 'win32':
      return {
        kind: 'manual',
        message: 'Install Tailscale for Windows, sign in, then press Check again.',
        url: 'https://tailscale.com/download/windows',
        command: 'winget install tailscale.tailscale',
      };
  }
}

export interface ResolveInstallPlanDeps {
  platform?: Platform;
  uid?: number | null;
  username?: string;
  /** Resolves when `path` is executable; rejects otherwise. */
  access?: (path: string) => Promise<void>;
  pathEnv?: string;
}

async function onPath(name: string, access: (path: string) => Promise<void>, pathEnv: string): Promise<boolean> {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, name));
      return true;
    } catch {
      // not here; keep scanning
    }
  }
  return false;
}

function currentUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

/** Gather the platform, user and PATH facts, then apply the D-9 table. */
export async function resolveInstallPlan(
  opts: { userspace: boolean; port?: number },
  deps: ResolveInstallPlanDeps = {},
): Promise<InstallPlan> {
  const access = deps.access ?? ((path: string) => fsAccess(path, constants.X_OK));
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? '';
  const [platform, hasSudo, hasBrew] = await Promise.all([
    deps.platform ?? Effect.runPromise(detectPlatform()),
    onPath('sudo', access, pathEnv),
    onPath('brew', access, pathEnv),
  ]);
  return installPlan({
    platform,
    uid: deps.uid !== undefined ? deps.uid : (process.getuid?.() ?? null),
    username: deps.username ?? currentUsername(),
    hasSudo,
    hasBrew,
    userspace: opts.userspace,
    port: opts.port ?? dashboardApiPort(),
  });
}
