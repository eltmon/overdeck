/**
 * Streams the host terminal of one shared conversation to watching viewers (PRD PAN-4477 WI-5).
 *
 * Each `attach` resolves the conversation's terminal afresh and opens one read-only stream for that
 * sink: a Herdr observe stream (D-6: opened without dims, so frames come at the PTY's own size) or a
 * listener on the tmux session's PTY hub (`subscribeToTmuxHub`). Frames map to `TerminalPayload`s;
 * an exit becomes `unavailable` (`terminal_ended` after a snapshot, `terminal_not_found` before).
 *
 * Read-only by construction: no source exposes a write method and nothing here writes to a
 * terminal. Nothing here logs.
 */
import { Effect } from 'effect';
import type { TerminalPayload } from '@overdeck/contracts';

import type { LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { observeTerminal } from '../../../lib/terminal-backends/herdr-stream.js';
import type { TerminalFrame, TerminalObservation } from '../../../lib/terminal-backends/types.js';
import { sessionExists } from '../../../lib/tmux.js';
import { subscribeToTmuxHub } from '../pty-hub-attach.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';
import { resolveHerdrTerminalId } from '../services/terminal-service.js';

export interface TerminalSink {
  send(payload: TerminalPayload): void;
}

export type TerminalTarget =
  | { readonly kind: 'herdr'; readonly terminalId: string }
  | { readonly kind: 'tmux'; readonly sessionName: string }
  | { readonly kind: 'missing' };

export interface TerminalBridgeDeps {
  resolveTarget(conversationName: string): Promise<TerminalTarget>;
  observeHerdr(terminalId: string): TerminalObservation;
  subscribeTmux(sessionName: string, onFrame: (frame: TerminalFrame) => void): Promise<{ close(): void } | null>;
}

const NO_OP = (): void => undefined;

/** Maps a backend frame to its wire payload; `exit` becomes `unavailable`. */
export function terminalPayloadOf(frame: TerminalFrame, sawSnapshot: boolean): TerminalPayload {
  switch (frame.kind) {
    case 'snapshot':
      return { kind: 'snapshot', cols: frame.cols, rows: frame.rows, data: frame.data };
    case 'output':
      return { kind: 'output', data: frame.data };
    case 'size':
      return { kind: 'size', cols: frame.cols, rows: frame.rows };
    case 'exit':
      return { kind: 'unavailable', reason: sawSnapshot ? 'terminal_ended' : 'terminal_not_found' };
  }
}

export class TerminalBridge {
  private readonly detaches = new Set<() => void>();
  private closed = false;

  constructor(
    private readonly conversationName: string,
    private readonly deps: TerminalBridgeDeps,
  ) {}

  /** Starts one read-only stream for this sink; resolves to its detach function. */
  async attach(sink: TerminalSink): Promise<() => void> {
    if (this.closed) return NO_OP;

    let detached = false;
    let finished = false;
    let sawSnapshot = false;
    let source: { close(): void } | null = null;

    const detach = (): void => {
      if (detached) return;
      detached = true;
      this.detaches.delete(detach);
      source?.close();
    };
    this.detaches.add(detach);

    const send = (payload: TerminalPayload): void => {
      if (detached) return;
      try {
        sink.send(payload);
      } catch {
        detach();
      }
    };
    const notFound = (): (() => void) => {
      send({ kind: 'unavailable', reason: 'terminal_not_found' });
      detach();
      return NO_OP;
    };
    const onFrame = (frame: TerminalFrame): void => {
      if (detached || finished) return;
      const payload = terminalPayloadOf(frame, sawSnapshot);
      if (frame.kind === 'snapshot') sawSnapshot = true;
      if (frame.kind === 'exit') finished = true;
      send(payload);
      if (finished) detach();
    };

    let target: TerminalTarget;
    try {
      target = await this.deps.resolveTarget(this.conversationName);
    } catch {
      target = { kind: 'missing' };
    }
    if (detached) return NO_OP;

    switch (target.kind) {
      case 'missing':
        return notFound();
      case 'herdr': {
        const observation = this.deps.observeHerdr(target.terminalId);
        source = observation;
        void this.pump(observation, onFrame, () => detached || finished);
        return detach;
      }
      case 'tmux': {
        const subscription = await this.deps.subscribeTmux(target.sessionName, onFrame);
        if (subscription === null) return detached ? NO_OP : notFound();
        source = subscription;
        // Detached (or the terminal ended) while the subscription opened: close it now.
        if (detached) subscription.close();
        return detach;
      }
    }
  }

  /** Detaches every sink; later attaches return a no-op detach and send nothing. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const detach of [...this.detaches]) detach();
  }

  private async pump(
    observation: TerminalObservation,
    onFrame: (frame: TerminalFrame) => void,
    stopped: () => boolean,
  ): Promise<void> {
    try {
      for await (const frame of observation.frames) {
        if (stopped()) return;
        onFrame(frame);
        if (stopped()) return;
      }
    } catch {
      // A failed stream ends like an exit.
    }
    onFrame({ kind: 'exit', code: null });
  }
}

async function resolveProductionTarget(conversationName: string): Promise<TerminalTarget> {
  const conv = await runDashboardDbJob<LegacyConversation | null>('getConversationByName', conversationName);
  if (!conv?.tmuxSession) return { kind: 'missing' };
  const terminalId = await resolveHerdrTerminalId(conv.tmuxSession);
  if (terminalId) return { kind: 'herdr', terminalId };
  const exists = await Effect.runPromise(sessionExists(conv.tmuxSession)).catch(() => false);
  return exists ? { kind: 'tmux', sessionName: conv.tmuxSession } : { kind: 'missing' };
}

export function productionTerminalBridgeDeps(): TerminalBridgeDeps {
  return {
    resolveTarget: resolveProductionTarget,
    observeHerdr: (terminalId) => observeTerminal(terminalId),
    subscribeTmux: (sessionName, onFrame) => subscribeToTmuxHub(sessionName, onFrame),
  };
}
