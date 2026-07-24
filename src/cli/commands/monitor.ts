import { watch, type FSWatcher } from 'fs';
import { mkdirSync } from 'fs';
import type { Command } from 'commander';
import { resolveAgentTargetSync } from '../../lib/agents.js';
import { inboxCommand } from './inbox.js';
import {
  agentMailDir,
  clearMonitorPresence,
  drainMailOnce,
  MONITOR_HEARTBEAT_INTERVAL_MS,
  writeMonitorPresence,
} from '../../lib/agents/monitor-transport.js';

const POLL_INTERVAL_MS = 2_000;

/** Registers `pan monitor` + `pan inbox` (kept out of the cli index god file). */
export function registerMonitorCommands(program: Command): void {
  program
    .command('monitor [id]')
    .description('Long-running background inbox: drain agent mail to stdout (run inside the agent session; PAN-3015)')
    .action(monitorCommand);
  program
    .command('inbox [id]')
    .description('Print full bodies of recent agent mail (unread + read archive); moves nothing')
    .option('--limit <n>', 'Max messages to print (default 10)')
    .action(inboxCommand);
}

/**
 * `pan monitor [id]` — long-running background inbox for a Claude Code session
 * (PAN-3015). Started as a background task inside the agent's own session; it
 * drains the durable mail queue and prints each message to stdout, where the
 * harness surfaces it to the model (waking an idle session). stdout carries
 * message blocks ONLY; all diagnostics go to stderr.
 */
export async function monitorCommand(id: string | undefined): Promise<void> {
  const rawTarget = id ?? process.env.OVERDECK_AGENT_ID;
  if (!rawTarget) {
    console.error('pan monitor: pass an agent id or set OVERDECK_AGENT_ID');
    process.exit(1);
  }
  const agentId = resolveAgentTargetSync(rawTarget) ?? rawTarget;

  const mailDir = agentMailDir(agentId);
  mkdirSync(mailDir, { recursive: true });

  const startedAt = new Date();
  writeMonitorPresence(agentId, process.pid, startedAt, startedAt);
  console.error(`[pan monitor] watching mail for ${agentId} (pid ${process.pid})`);

  let draining = false;
  const drain = async (): Promise<void> => {
    if (draining) return; // A drain is already claiming files; renames make this safe anyway.
    draining = true;
    try {
      await drainMailOnce(agentId, (block) => console.log(block));
    } catch (err) {
      console.error(`[pan monitor] drain failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      draining = false;
    }
  };

  // fs.watch is the fast path; the poll interval is the reliability backstop
  // (watch events are not guaranteed on all platforms/filesystems).
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(mailDir, () => { void drain(); });
  } catch (err) {
    console.error(`[pan monitor] fs.watch unavailable, polling only: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pollTimer = setInterval(() => { void drain(); }, POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    writeMonitorPresence(agentId, process.pid, startedAt, new Date());
  }, MONITOR_HEARTBEAT_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    watcher?.close();
    clearMonitorPresence(agentId);
    console.error(`[pan monitor] stopped for ${agentId}`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await drain();
  // Stay alive until signalled; timers keep the event loop busy.
  await new Promise(() => {});
}
