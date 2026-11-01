/**
 * `pan connect` on Linux (PAN-4656, FR-4, FR-5, D-8, D-9): install, enable and
 * start the supervisor unit, save the operator's PATH for the user manager
 * first, then turn lingering on so the server outlives logout and starts at
 * boot. When lingering cannot be turned on without a password, print the sudo
 * command and, on a TTY without --json, wait until it is on or the operator
 * presses Enter. Not having lingering is not an error: the outcome says so.
 *
 * `pan up` never runs this, so only a connected machine's unit is enabled.
 */
import { installSupervisorUnit, enableUserUnit, startSupervisorUnit, SUPERVISOR_UNIT_NAME } from '../../lib/systemd.js';
import {
  isLingerEnabled,
  lingerSudoCommand,
  persistUserManagerPath,
  tryEnableLinger,
  waitForLinger,
} from '../../lib/systemd-user-session.js';
import type { ServiceContext, ServiceOutcome } from './connect-service.js';

type EnterSource = Pick<NodeJS.ReadStream, 'once' | 'removeListener' | 'pause'>;

export interface LinuxServiceDeps {
  installSupervisorUnit: () => Promise<unknown>;
  enableUserUnit: (unitName: string) => Promise<void>;
  persistUserManagerPath: (path: string) => Promise<unknown>;
  startSupervisorUnit: () => Promise<void>;
  isLingerEnabled: (user: string) => Promise<boolean>;
  tryEnableLinger: (user: string) => Promise<boolean>;
  waitForLinger: (user: string, skip: Promise<void>) => Promise<'on' | 'off'>;
  /** Where Enter comes from; the lib never touches stdin. */
  stdin: EnterSource;
}

const defaultDeps: LinuxServiceDeps = {
  installSupervisorUnit: () => installSupervisorUnit(),
  enableUserUnit,
  persistUserManagerPath: (path) => persistUserManagerPath(path),
  startSupervisorUnit,
  isLingerEnabled: (user) => isLingerEnabled(user),
  tryEnableLinger: (user) => tryEnableLinger(user),
  waitForLinger: (user, skip) => waitForLinger(user, skip),
  stdin: process.stdin,
};

/** Waits for lingering until it turns on or a line arrives on stdin; always detaches from stdin. */
async function waitForLingerOrEnter(user: string, d: LinuxServiceDeps): Promise<'on' | 'off'> {
  let onData: (() => void) | undefined;
  const enterPressed = new Promise<void>((resolve) => {
    onData = () => resolve();
    d.stdin.once('data', onData);
  });
  try {
    return await d.waitForLinger(user, enterPressed);
  } finally {
    if (onData) d.stdin.removeListener('data', onData);
    // Let `pan connect` exit after printing the link.
    d.stdin.pause();
  }
}

async function turnOnLinger(ctx: ServiceContext, d: LinuxServiceDeps): Promise<'on' | 'off'> {
  if (await d.isLingerEnabled(ctx.user)) return 'on';
  if (await d.tryEnableLinger(ctx.user)) return 'on';

  ctx.progress(`Lingering is off for ${ctx.user}. Run this in another terminal on this machine:`);
  ctx.progress(`  ${lingerSudoCommand(ctx.user)}`);
  if (!ctx.isTTY || ctx.json) return 'off';
  ctx.progress('Waiting for lingering to turn on… (press Enter to continue without it)');
  return waitForLingerOrEnter(ctx.user, d);
}

export async function installLinuxService(ctx: ServiceContext, deps: Partial<LinuxServiceDeps> = {}): Promise<ServiceOutcome> {
  const d = { ...defaultDeps, ...deps };
  await d.installSupervisorUnit();
  await d.enableUserUnit(SUPERVISOR_UNIT_NAME);
  // Before the start: set-environment reaches only units started afterwards (D-8).
  if (ctx.env.PATH) await d.persistUserManagerPath(ctx.env.PATH);
  await d.startSupervisorUnit();

  const linger = await turnOnLinger(ctx, d);
  return {
    manager: 'systemd',
    name: SUPERVISOR_UNIT_NAME,
    enabled: true,
    line: `user service ${SUPERVISOR_UNIT_NAME}, enabled at boot.`,
    linger,
    note: linger === 'on'
      ? `Lingering is on for ${ctx.user}, so the server keeps running after you log out and starts at boot.`
      : `Lingering is off for ${ctx.user}, so the server stops when you log out and starts again only when you log in. `
        + `Turn it on with: ${lingerSudoCommand(ctx.user)}`,
  };
}
