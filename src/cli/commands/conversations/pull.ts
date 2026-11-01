/**
 * `pan conv pull` and `pan conv reclaim` (PAN-4650 WI-11, D-4650-10/12).
 *
 * `pull <@machine/conv> [--stop-turn]` makes this machine own a conversation
 * that runs on a linked machine: it starts the dashboard's Pull here job and
 * prints each step (release, transfer, adopt, finish) as the job reaches it,
 * then the new conversation's URL. With `--stop-turn` a running turn is
 * stopped; otherwise the owner waits for it (up to 30 minutes).
 *
 * `reclaim <conv> [--force]` takes back a conversation this machine released
 * when the machine it went to does not run it. It refuses while that machine
 * runs it, and when that machine cannot be asked unless `--force`.
 *
 * Exit codes: 0 ok; 1 refused or failed; 2 not found.
 */
import chalk from 'chalk';

import { exitCli } from '../../exit.js';
import { callDashboard, errorText } from '../dashboard-call.js';

export const PULL_POLL_MS = 1_000;
const STEPS = ['release', 'transfer', 'adopt', 'finish'] as const;

interface PullStatus {
  step: (typeof STEPS)[number];
  state: 'running' | 'done' | 'failed';
  mode?: 'online' | 'offline';
  error?: string;
  code?: string;
  conversation?: { id: number; name: string };
}

export interface PullCliDeps {
  call: typeof callDashboard;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  error: (line: string) => void;
}

const defaultDeps: PullCliDeps = {
  call: callDashboard,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (line) => console.log(line),
  error: (line) => console.error(chalk.red(line)),
};

/** Run a pull; resolves with the exit code. */
export async function pullConversation(
  target: string,
  opts: { stopTurn?: boolean; json?: boolean },
  overrides: Partial<PullCliDeps> = {},
): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  if (!target.startsWith('@') || !target.includes('/')) {
    deps.error('Name the conversation as @<machine>/<conversation>, for example @desk/conv-20261101-1234');
    return 1;
  }
  const started = await deps.call('/api/linked-conversations/pull', {
    method: 'POST',
    body: { conversation: target, whenTurnRunning: opts.stopTurn ? 'stop' : 'wait' },
  });
  if (started.status !== 202) {
    deps.error(`Error: ${await errorText(started)}`);
    return started.status === 404 ? 2 : 1;
  }
  const { pullId } = (await started.json()) as { pullId: string };
  let printed = 0;
  const printThrough = (step: PullStatus['step'], state: PullStatus['state']) => {
    // A failed step is not printed as reached; the error says where it stopped.
    const through = STEPS.indexOf(step) + (state === 'failed' ? 0 : 1);
    for (; printed < through; printed++) if (!opts.json) deps.log(STEPS[printed]!);
  };
  for (;;) {
    const response = await deps.call(`/api/linked-conversations/pull/${encodeURIComponent(pullId)}`, { method: 'GET' });
    if (!response.ok) {
      deps.error(`Error: ${await errorText(response)}`);
      return 1;
    }
    const status = (await response.json()) as PullStatus;
    if (status.state === 'running') {
      printThrough(status.step, 'failed');
      await deps.sleep(PULL_POLL_MS);
      continue;
    }
    printThrough(status.step, status.state);
    if (opts.json) deps.log(JSON.stringify(status));
    if (status.state === 'failed') {
      deps.error(`Error (${status.step}${status.code ? `, ${status.code}` : ''}): ${status.error ?? 'the pull failed'}`);
      return 1;
    }
    if (!opts.json && status.conversation) deps.log(`Pulled: /conv/${status.conversation.id}`);
    return 0;
  }
}

/** Run a reclaim; resolves with the exit code. */
export async function reclaimConversation(name: string, opts: { force?: boolean }, overrides: Partial<PullCliDeps> = {}): Promise<number> {
  const deps = { ...defaultDeps, ...overrides };
  const response = await deps.call(`/api/conversations/${encodeURIComponent(name)}/reclaim`, { method: 'POST', body: { force: opts.force === true } });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
    deps.error(`Error${body?.code ? ` (${body.code})` : ''}: ${body?.error ?? `HTTP ${response.status}`}`);
    return response.status === 404 ? 2 : 1;
  }
  deps.log(`Reclaimed ${name}: this machine owns it again. Resume it to continue.`);
  return 0;
}

export async function pullAction(target: string, opts: { stopTurn?: boolean; json?: boolean }): Promise<void> {
  const code = await pullConversation(target, opts);
  if (code !== 0) await exitCli(code);
}

export async function reclaimAction(name: string, opts: { force?: boolean }): Promise<void> {
  const code = await reclaimConversation(name, opts);
  if (code !== 0) await exitCli(code);
}
