/**
 * Pi Event Poller (PAN-1134)
 *
 * Reads domain events written by the Pi extension's events.jsonl and appends
 * them to the event store so Pi agents participate in activity tracking,
 * model_set folding, and idle-detection workflows.
 *
 * Polls every 3 seconds. For each running Pi agent:
 *   1. Read events.jsonl via PiRuntime.getPendingEvents()
 *   2. Map each line through bodyToEvent()
 *   3. Append valid events to EventStore
 *   4. PiRuntime truncates the file atomically after read
 */

import { listRunningAgents } from '../../../lib/agents.js';
import { getRuntimeForAgent } from '../../../lib/runtimes/index.js';
import { PiRuntime } from '../../../lib/runtimes/pi.js';
import { bodyToEvent } from './agent-event-utils.js';
import { getEventStore } from '../event-store.js';

const POLL_INTERVAL_MS = 3_000;

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export async function pollPiEvents(): Promise<void> {
  try {
    const agents = listRunningAgents();
    const piAgents = agents.filter((a) => a.harness === 'pi' && a.tmuxActive);
    if (piAgents.length === 0) return;

    const store = getEventStore();

    for (const agent of piAgents) {
      const runtime = getRuntimeForAgent(agent.id);
      if (!runtime || !(runtime instanceof PiRuntime)) continue;

      const events = runtime.getPendingEvents(agent.id);
      if (events.length === 0) continue;

      for (const ev of events) {
        const timestamp =
          typeof ev['timestamp'] === 'string'
            ? ev['timestamp']
            : new Date().toISOString();
        const mapped = bodyToEvent(agent.id, ev, timestamp);
        if (!mapped) continue;

        try {
          await store.appendAsync(mapped as never);
        } catch (err) {
          console.error(
            `[pi-event-poller] Failed to append event for ${agent.id}:`,
            err,
          );
        }
      }
    }
  } catch (err: unknown) {
    console.error('[pi-event-poller] Poll error:', err);
  }
}

function scheduleNext(): void {
  pollTimer = setTimeout(async () => {
    await pollPiEvents();
    scheduleNext();
  }, POLL_INTERVAL_MS);
}

export function startPiEventPoller(): void {
  console.log('[panopticon] PiEventPoller started (3s poll)');
  // Immediate first poll
  void pollPiEvents();
  scheduleNext();
}

export function stopPiEventPoller(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[panopticon] PiEventPoller stopped');
  }
}
