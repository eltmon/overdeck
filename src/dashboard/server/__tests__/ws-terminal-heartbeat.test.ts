import { EventEmitter } from 'node:events';

import type { WebSocket } from 'ws';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  TERMINAL_HEARTBEAT_QUERY_PARAM,
  startTerminalHeartbeat,
  wantsTerminalHeartbeat,
} from '../ws-terminal-heartbeat.js';

class FakeSocket extends EventEmitter {
  terminate = vi.fn();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('startTerminalHeartbeat', () => {
  it('sends a ping every 20 s', () => {
    const socket = new FakeSocket();
    const sendPing = vi.fn();
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    for (let i = 0; i < 3; i++) {
      socket.emit('message', 'x');
      vi.advanceTimersByTime(20_000);
    }

    expect(sendPing).toHaveBeenCalledTimes(3);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('a pong resets the missed counter', () => {
    const socket = new FakeSocket();
    const sendPing = vi.fn();
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    vi.advanceTimersByTime(20_000); // tick 1: missed 1, ping
    socket.emit('message', '{"type":"pong"}');
    vi.advanceTimersByTime(20_000); // tick 2: missed 0, ping
    vi.advanceTimersByTime(20_000); // tick 3: missed 1, ping
    expect(socket.terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000); // tick 4: missed 2
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('terminates after 2 missed intervals', () => {
    const socket = new FakeSocket();
    const sendPing = vi.fn();
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    vi.advanceTimersByTime(20_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(sendPing).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(20_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(sendPing).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(80_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('10 simulated minutes with pongs never exceed a 20 s gap and never terminate', () => {
    const socket = new FakeSocket();
    const start = Date.now();
    const timestamps: number[] = [];
    const sendPing = vi.fn(() => {
      timestamps.push(Date.now());
      socket.emit('message', '{"type":"pong"}');
    });
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    vi.advanceTimersByTime(600_000);

    expect(timestamps).toHaveLength(30);
    let previous = start;
    for (const t of timestamps) {
      expect(t - previous).toBeLessThanOrEqual(20_000);
      previous = t;
    }
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('stops on close', () => {
    const socket = new FakeSocket();
    const sendPing = vi.fn();
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    socket.emit('close');
    vi.advanceTimersByTime(120_000);

    expect(sendPing).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('stops on error', () => {
    const socket = new FakeSocket();
    const sendPing = vi.fn();
    startTerminalHeartbeat(socket as unknown as WebSocket, sendPing);

    socket.emit('error');
    vi.advanceTimersByTime(120_000);

    expect(sendPing).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
  });
});

describe('wantsTerminalHeartbeat', () => {
  it('is true only for heartbeat=1', () => {
    expect(wantsTerminalHeartbeat(new URL('http://x/ws/terminal?session=x&heartbeat=1'))).toBe(true);
    expect(wantsTerminalHeartbeat(new URL('http://x/ws/terminal?session=x'))).toBe(false);
    expect(wantsTerminalHeartbeat(new URL('http://x/ws/terminal?session=x&heartbeat=0'))).toBe(false);
    expect(TERMINAL_HEARTBEAT_QUERY_PARAM).toBe('heartbeat');
  });
});
