/**
 * Open a linked conversation's checkout in a local editor over remote SSH
 * (PAN-4650 WI-20, FR-8, D-4650-18).
 *
 * `code --remote ssh-remote+<host> <cwd>`, with the host from the link: a
 * route of kind `ssh` first (none exist until #4404), then the `tailnet`
 * route whose URL is `wss://<name>/ws/link`, then any `tailnet` route. Only
 * VS Code, VS Code Insiders and VSCodium are supported: Cursor's and
 * Windsurf's remote-SSH launch could not be verified (D-4650-18 checkpoint).
 */
import type { EditorId } from '@overdeck/contracts';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';

/** Editors whose CLI takes `--remote ssh-remote+<host>`. */
export const REMOTE_EDITOR_COMMANDS: Partial<Record<EditorId, string>> = {
  vscode: 'code',
  'vscode-insiders': 'code-insiders',
  vscodium: 'codium',
};

export const REMOTE_EDITOR_UNSUPPORTED_HINT = 'Remote SSH works with VS Code, VS Code Insiders and VSCodium';

export type RemoteEditorLaunch =
  | { command: string; args: string[] }
  | { error: 'no-ssh-host' | 'editor-unsupported' };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** The SSH host of a linked machine, by the D-4650-18 order, or null. */
export function sshHostFor(link: Pick<MachineLink, 'routes'>): string | null {
  const ssh = link.routes.find((route) => route.kind === 'ssh');
  if (ssh) return hostOf(ssh.url);
  const tailnet = link.routes.filter((route) => route.kind === 'tailnet');
  const linkRoute = tailnet.find((route) => route.url.startsWith('wss://') && new URL(route.url).pathname === '/ws/link');
  for (const route of linkRoute ? [linkRoute, ...tailnet] : tailnet) {
    const host = hostOf(route.url);
    if (host) return host;
  }
  return null;
}

export function resolveRemoteEditorLaunch(input: { editor: string; link: Pick<MachineLink, 'routes'>; cwd: string }): RemoteEditorLaunch {
  const command = REMOTE_EDITOR_COMMANDS[input.editor as EditorId];
  if (!command) return { error: 'editor-unsupported' };
  const host = sshHostFor(input.link);
  if (!host) return { error: 'no-ssh-host' };
  return { command, args: ['--remote', `ssh-remote+${host}`, input.cwd] };
}
