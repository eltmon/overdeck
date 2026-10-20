/**
 * Codex replay harness (PAN-4563): a fake `codex app-server` child that plays
 * a recorded protocol fixture, so the real stdio transport, manager, and host
 * run against recorded provider behavior with no child process.
 */
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { loadProtocolFixture, type ProtocolFixture } from '../../protocol-capture/fixture.js';
import { createProtocolReplay, type ProtocolReplay } from '../../protocol-capture/replay.js';
import { CodexAppServerHost } from '../app-server-host.js';
import { CodexAppServerManager } from '../app-server-manager.js';

/** The cwd every replay runs with; recorded paths are scrubbed to `<CWD>`. */
export const REPLAY_CWD = '/replay/cwd';

export function createReplayAppServer(replay: ProtocolReplay): { child: ChildProcessWithoutNullStreams } {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  let buffered = '';
  replay.onServerLine(line => stdout.write(`${line}\n`));
  stdin.on('data', chunk => {
    buffered += String(chunk);
    replay.start();
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (line.trim() !== '') replay.acceptClientLine(line);
    }
  });
  const child = Object.assign(emitter, { stdin, stdout, stderr, kill: () => true }) as unknown as ChildProcessWithoutNullStreams;
  return { child };
}

export function codexFixturePath(fixtureName: string): string {
  return fileURLToPath(new URL(`../__fixtures__/replay/${fixtureName}.jsonl`, import.meta.url));
}

export interface CodexReplay {
  replay: ProtocolReplay;
  manager: CodexAppServerManager;
  host: CodexAppServerHost;
  /** Pane lines the host wrote to stdout. */
  lines: string[];
  recordActivity: (agentId: string, activity: { at?: string; costSoFar?: number }) => boolean;
  activity: Array<{ at?: string; costSoFar?: number }>;
}

function captureLines(): { stdout: Writable; lines: string[] } {
  const lines: string[] = [];
  let buffer = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      callback();
    },
  });
  return { stdout, lines };
}

/**
 * Load a fixture (by name under `__fixtures__/replay/`, or inline), build the
 * real manager and host over a replay child, and run `manager.start()`. It
 * never calls `host.start()`, so no control socket opens.
 */
export async function startCodexReplay(fixture: string | ProtocolFixture, deps: { overdeckHome: string }): Promise<CodexReplay> {
  const loaded = typeof fixture === 'string' ? await loadProtocolFixture(codexFixturePath(fixture)) : fixture;
  const replay = createProtocolReplay(loaded);
  const { child } = createReplayAppServer(replay);
  const hostOptions = loaded.header.hostOptions ?? {};
  const manager = new CodexAppServerManager({
    cwd: REPLAY_CWD,
    readVersion: async () => `codex-cli ${loaded.header.cliVersion ?? '0.0.0'}`,
    spawnProcess: () => child,
    requestTimeoutMs: 600_000,
  });
  const { stdout, lines } = captureLines();
  const activity: Array<{ at?: string; costSoFar?: number }> = [];
  const recordActivity = (_agentId: string, entry: { at?: string; costSoFar?: number }) => {
    activity.push(entry);
    return true;
  };
  const host = new CodexAppServerHost({
    agentId: 'agent-replay',
    cwd: REPLAY_CWD,
    overdeckHome: deps.overdeckHome,
    manager,
    model: typeof hostOptions.model === 'string' ? hostOptions.model : undefined,
    effort: typeof hostOptions.effort === 'string' ? hostOptions.effort : 'low',
    stdout,
    recordActivity,
  });
  await manager.start();
  return { replay, manager, host, lines, recordActivity, activity };
}
