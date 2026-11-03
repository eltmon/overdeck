/**
 * `pan join <link-or-code>` — join a shared conversation from the terminal (PRD PAN-4480 WI-4,
 * FR-4–FR-10, D-4–D-9).
 *
 * Order: parse the target (no network or file write on a bad one), sign in with the device flow
 * when `account.json` is missing, make sure a local dashboard runs (auto-starting the bundled
 * server, see `local-dashboard.ts`), post the join intent with the internal token, poll while the
 * join is `connecting`, then open `<apiUrl>/#/shared/<CODE>`. The browser URL carries no token
 * (D-6); the page subscribes to the live join without a second click (D-7).
 */
import type { JoinState, JoinView } from '@overdeck/contracts';

import { readAccount } from '../../../lib/account/store.js';
import { formatShareCode, parseJoinTarget } from '../../../lib/sharing/share-code.js';
import { defaultAccountIo, type AccountIo } from '../account/shared.js';
import { callDashboard as defaultCallDashboard, errorText, isDashboardUnreachable } from '../dashboard-call.js';
import { ensureLocalDashboard, LocalDashboardError, openDashboardUrl, type LocalDashboard } from './local-dashboard.js';

export const JOIN_SETTLE_POLL_MS = 500;
export const JOIN_SETTLE_TIMEOUT_MS = 15_000;

const UNREACHABLE_MESSAGE = 'The Overdeck dashboard is not running. Start it with pan up, then run pan join again.';

export interface JoinOptions {
  open?: boolean;
}

export interface JoinDeps {
  fetch?: typeof fetch;
  ensureDashboard?: () => Promise<LocalDashboard>;
  callDashboard?: typeof defaultCallDashboard;
  openUrl?: (url: string) => Promise<void>;
}

/** The line printed for a state that leaves the browser closed and exits 1. */
function terminalMessage(view: JoinView): string {
  switch (view.state) {
    case 'ended':
      return 'This share has ended, or the code is wrong.';
    case 'rejected':
      return 'overdeck.ai rejected this sign-in. Run: pan account login';
    case 'is-host':
      return 'You are the host of this share. Open the conversation in your dashboard instead.';
    case 'full':
      return 'This share is full.';
    case 'revoked':
      return 'The host blocked you from this share.';
    case 'disconnected':
      return `Cannot reach the share service (${view.error ?? 'unknown error'}).`;
    default:
      return `The join ended (${view.state}). Run pan join again.`;
  }
}

/** The line printed for a state that opens the browser and exits 0; null for a terminal state. */
function liveMessage(state: JoinState, code: string): string | null {
  switch (state) {
    case 'lobby':
      return `Waiting for the host to let you in (${code}).`;
    case 'admitted':
      return `You are in (${code}).`;
    case 'host-disconnected':
      return 'You are in, but the host is disconnected. The page reconnects when the host returns.';
    case 'reconnecting':
      // A live join whose socket dropped; the viewer server reconnects it on its own (PAN-4479).
      return `Reconnecting to the share service (${code}). The page shows the conversation when it reconnects.`;
    case 'connecting':
      return 'Still connecting to the share service. The page shows the lobby when it connects.';
    default:
      return null;
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function joinCommand(
  target: string,
  options: JoinOptions,
  io: AccountIo = defaultAccountIo,
  deps: JoinDeps = {},
): Promise<void> {
  const code = parseJoinTarget(target);
  if (code === null) {
    io.err(`Not a share link or join code: ${target}. A join code looks like BCDF-GHJK.`);
    return io.exit(1);
  }

  try {
    if ((await readAccount()) === null) {
      io.out('Sign in to overdeck.ai to join this conversation.');
      const { loginCommand } = await import('../account/login.js');
      await loginCommand({}, io, { fetch: deps.fetch });
      if ((await readAccount()) === null) {
        io.err('Sign-in did not complete. Run: pan account login');
        return io.exit(1);
      }
    }
  } catch (error) {
    io.err((error as Error).message);
    return io.exit(1);
  }

  let dashboard: LocalDashboard;
  try {
    dashboard = await (deps.ensureDashboard ?? ensureLocalDashboard)();
  } catch (error) {
    if (!(error instanceof LocalDashboardError)) throw error;
    io.err(error.message);
    return io.exit(1);
  }
  if (dashboard.started) io.out(`Started Overdeck at ${dashboard.apiUrl}.`);

  const call = deps.callDashboard ?? defaultCallDashboard;
  let view: JoinView;
  try {
    const response = await call('/api/joins', { method: 'POST', body: { code } });
    if (response.status !== 200 && response.status !== 201) {
      io.err(`Cannot join: ${await errorText(response)}`);
      return io.exit(1);
    }
    view = (await response.json()) as JoinView;

    // D-9: settle before opening the browser. Elapsed time is the sum of the waits.
    for (let waited = 0; view.state === 'connecting' && waited < JOIN_SETTLE_TIMEOUT_MS; waited += JOIN_SETTLE_POLL_MS) {
      await wait(JOIN_SETTLE_POLL_MS);
      const poll = await call(`/api/joins/${code}`, { method: 'GET' });
      if (poll.status !== 200) {
        io.err(`Cannot join: ${await errorText(poll)}`);
        return io.exit(1);
      }
      view = (await poll.json()) as JoinView;
    }
  } catch (error) {
    if (!isDashboardUnreachable(error)) throw error;
    io.err(UNREACHABLE_MESSAGE);
    return io.exit(1);
  }

  const message = liveMessage(view.state, formatShareCode(code));
  if (message === null) {
    io.err(terminalMessage(view));
    return io.exit(1);
  }
  io.out(message);

  const url = `${dashboard.apiUrl}/#/shared/${code}`;
  if (options.open !== false) {
    await (deps.openUrl ?? openDashboardUrl)(url).catch(() => {
      io.out(`Open this URL in your browser: ${url}`);
    });
  }
  io.out(`Shared conversation: ${url}`);
  if (options.open === false) io.out('Opening the page later rejoins automatically.');
}
