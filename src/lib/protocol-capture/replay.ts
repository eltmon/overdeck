/**
 * Protocol fixture replay engine (PAN-4563).
 *
 * A test-only stand-in for a provider process. It plays a fixture's `in`
 * frames to the real client code in recorded order, one per scheduler tick,
 * and stops at each `out` frame until the client writes a matching line.
 *
 * Matching: kinds must match; requests and notifications match by `method`;
 * client responses match by `id` and a deep-equal `result` (or both carry an
 * `error`). Client request params are not compared. A client line that arrives
 * before its recorded position is queued and matched when the cursor gets
 * there. The live id of each client request replaces the recorded id in the
 * recorded response; server-request ids are replayed verbatim because the
 * client echoes them.
 *
 * `done` resolves once every `in` frame is delivered and every `out` frame
 * before the last `in` frame has matched. Later `out` frames (the optional
 * tail) are matched if they arrive and never waited on.
 *
 * Breakpoints (`pauseBefore`, `awaitingClient`) find their target frame by a
 * forward scan when they are armed, so a matcher that names no later frame
 * rejects at once instead of hanging the test.
 */
import { frameKind, type FrameDirection, type ProtocolFixture, type ProtocolFrame } from './fixture.js';

export interface ReplayMatcher {
  dir?: FrameDirection;
  method?: string;
  threadId?: string;
  where?: (frame: ProtocolFrame) => boolean;
}

export class ReplayMismatchError extends Error {
  override name = 'ReplayMismatchError';
}

export interface ProtocolReplay {
  readonly fixture: ProtocolFixture;
  /** Adapter: register the function that delivers one server line (no trailing newline) to the client. */
  onServerLine(deliver: (line: string) => void): void;
  /** Adapter: hand over each complete line the client wrote. */
  acceptClientLine(line: string): void;
  /** Begin delivering frames. Adapters call this once the client is attached. */
  start(): void;
  /** Resolves when the cursor reaches the next `in` frame matching `matcher`, without delivering it; delivery pauses there. */
  pauseBefore(matcher: ReplayMatcher): Promise<ProtocolFrame>;
  /** Resolves when the cursor reaches an `out` frame matching `matcher` and is waiting for the client. */
  awaitingClient(matcher: ReplayMatcher): Promise<ProtocolFrame>;
  resume(): void;
  /** Resolves when every `in` frame is delivered; rejects with ReplayMismatchError on the first mismatch. */
  readonly done: Promise<void>;
  /** Client lines that were never matched (extra frames, or frames left after `done`). */
  unmatchedClientLines(): string[];
}

interface Breakpoint {
  kind: 'pause' | 'await';
  target: number;
  resolve: (frame: ProtocolFrame) => void;
  reject: (error: Error) => void;
}

interface ClientLine {
  raw: string;
  message: Record<string, unknown> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Same rule as `messageThreadId` in codex/app-server-manager.ts, kept local so this module stays a leaf. */
function frameThreadId(frame: ProtocolFrame): string | undefined {
  const params = frame.message?.params;
  if (!isRecord(params)) return undefined;
  if (typeof params.threadId === 'string') return params.threadId;
  return isRecord(params.thread) && typeof params.thread.id === 'string' ? params.thread.id : undefined;
}

function matcherMatches(frame: ProtocolFrame, matcher: ReplayMatcher): boolean {
  if (matcher.dir !== undefined && frame.dir !== matcher.dir) return false;
  if (matcher.method !== undefined && frame.message?.method !== matcher.method) return false;
  if (matcher.threadId !== undefined && frameThreadId(frame) !== matcher.threadId) return false;
  return matcher.where === undefined || matcher.where(frame);
}

function describeMatcher(matcher: ReplayMatcher): string {
  const parts = Object.entries(matcher)
    .filter(([key, value]) => key !== 'where' && value !== undefined)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  if (matcher.where) parts.push('where=<fn>');
  return `{ ${parts.join(', ')} }`;
}

function describeFrame(frame: ProtocolFrame): string {
  return frame.message ? JSON.stringify(frame.message) : JSON.stringify(frame.text);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const aKeys = Object.keys(a).filter(key => a[key] !== undefined);
  const bKeys = Object.keys(b).filter(key => b[key] !== undefined);
  return aKeys.length === bKeys.length && aKeys.every(key => deepEqual(a[key], b[key]));
}

export function createProtocolReplay(
  fixture: ProtocolFixture,
  options: { schedule?: (fn: () => void) => void } = {},
): ProtocolReplay {
  const schedule = options.schedule ?? ((fn: () => void) => void setImmediate(fn));
  const frames = fixture.frames;
  const lastInIndex = frames.reduce((last, frame, index) => (frame.dir === 'in' ? index : last), -1);
  const queue: ClientLine[] = [];
  const extraLines: string[] = [];
  /** Recorded client-request id → the id the live client used. */
  const idMap = new Map<unknown, unknown>();
  let breakpoints: Breakpoint[] = [];
  let deliver: ((line: string) => void) | undefined;
  let cursor = 0;
  /** The frame index `resume()` released; a new pause never re-targets it. */
  let released = -1;
  let started = false;
  let paused = false;
  let scheduled = false;
  let doneSettled = false;
  let failed = false;

  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Callers await `done`; this keeps an unobserved failure from crashing the run.
  done.catch(() => undefined);

  const fail = (error: Error): void => {
    if (failed) return;
    failed = true;
    for (const breakpoint of breakpoints) breakpoint.reject(error);
    breakpoints = [];
    if (!doneSettled) {
      doneSettled = true;
      rejectDone(error);
    }
  };

  const checkDone = (): void => {
    if (doneSettled || failed || cursor <= lastInIndex) return;
    doneSettled = true;
    resolveDone();
  };

  /** Resolve and remove the breakpoints of `kind` aimed at the cursor; true when any fired. */
  const fireBreakpoints = (kind: Breakpoint['kind']): boolean => {
    const firing = breakpoints.filter(breakpoint => breakpoint.kind === kind && breakpoint.target === cursor);
    if (firing.length === 0) return false;
    breakpoints = breakpoints.filter(breakpoint => !firing.includes(breakpoint));
    for (const breakpoint of firing) breakpoint.resolve(frames[cursor]!);
    return true;
  };

  /** Match a client line against the `out` frame at the cursor; returns a mismatch reason or undefined. */
  const mismatch = (frame: ProtocolFrame, line: ClientLine): string | undefined => {
    if (!frame.message) return line.raw === frame.text ? undefined : 'text differs';
    if (!line.message) return 'client line is not a JSON object';
    const expectedKind = frameKind(frame);
    const actualKind = frameKind({ type: 'frame', seq: frame.seq, dir: 'out', t: 0, message: line.message });
    if (expectedKind !== actualKind) return `expected a ${expectedKind}, got a ${actualKind}`;
    if (expectedKind === 'request' || expectedKind === 'notification') {
      return frame.message.method === line.message.method ? undefined : 'method differs';
    }
    if (frame.message.id !== line.message.id) return 'response id differs';
    if ('error' in frame.message || 'error' in line.message) {
      return 'error' in frame.message && 'error' in line.message ? undefined : 'one side has an error';
    }
    return deepEqual(frame.message.result, line.message.result) ? undefined : 'result differs';
  };

  const renderInFrame = (frame: ProtocolFrame): string => {
    const message = frame.message;
    if (!message) return frame.text ?? '';
    if (frameKind(frame) === 'response' && idMap.has(message.id)) {
      return JSON.stringify({ ...message, id: idMap.get(message.id) });
    }
    return JSON.stringify(message);
  };

  const pump = (): void => {
    if (!started || failed || paused || scheduled) return;
    while (cursor < frames.length) {
      const frame = frames[cursor]!;
      if (frame.dir === 'out') {
        fireBreakpoints('await');
        const line = queue[0];
        if (!line) return;
        const reason = mismatch(frame, line);
        if (reason) {
          if (cursor > lastInIndex) {
            // Optional tail: never fail the replay over a frame it does not wait for.
            extraLines.push(queue.shift()!.raw);
            continue;
          }
          fail(new ReplayMismatchError(
            `replay mismatch at seq ${frame.seq} (${reason}): expected ${describeFrame(frame)}, got ${line.raw}`,
          ));
          return;
        }
        queue.shift();
        if (frameKind(frame) === 'request') idMap.set(frame.message!.id, line.message!.id);
        cursor += 1;
        checkDone();
        continue;
      }
      if (fireBreakpoints('pause')) {
        paused = true;
        return;
      }
      scheduleDelivery(frame, true);
      return;
    }
  };

  function scheduleDelivery(frame: ProtocolFrame, holdForBreakpoints: boolean): void {
    scheduled = true;
    schedule(() => {
      scheduled = false;
      if (failed || paused) return;
      // A breakpoint armed after the delivery was scheduled still holds this frame.
      if (holdForBreakpoints && fireBreakpoints('pause')) {
        paused = true;
        return;
      }
      deliver!(renderInFrame(frame));
      cursor += 1;
      checkDone();
      pump();
    });
  }

  const arm = (kind: Breakpoint['kind'], matcher: ReplayMatcher): Promise<ProtocolFrame> => {
    const dir: FrameDirection = kind === 'pause' ? 'in' : 'out';
    let target = -1;
    const from = kind === 'pause' && released === cursor ? cursor + 1 : cursor;
    for (let index = from; index < frames.length; index += 1) {
      if (frames[index]!.dir === dir && matcherMatches(frames[index]!, matcher)) {
        target = index;
        break;
      }
    }
    const name = kind === 'pause' ? 'pauseBefore' : 'awaitingClient';
    if (failed) return Promise.reject(new ReplayMismatchError(`${name}${describeMatcher(matcher)}: the replay already failed`));
    if (target < 0) {
      const at = cursor < frames.length ? `seq ${frames[cursor]!.seq}` : 'the end of the fixture';
      return Promise.reject(new ReplayMismatchError(
        `${name}${describeMatcher(matcher)}: no ${dir} frame from ${at} onward matches`,
      ));
    }
    // Already standing at the target: paused before it, or waiting for the client there.
    if (target === cursor && started && (kind === 'await' || paused)) return Promise.resolve(frames[target]!);
    return new Promise<ProtocolFrame>((resolve, reject) => {
      breakpoints.push({ kind, target, resolve, reject });
    });
  };

  return {
    fixture,
    onServerLine(handler) {
      deliver = handler;
    },
    acceptClientLine(raw) {
      let message: Record<string, unknown> | undefined;
      try {
        const parsed: unknown = JSON.parse(raw);
        message = isRecord(parsed) ? parsed : undefined;
      } catch {
        message = undefined;
      }
      if (cursor >= frames.length || failed) {
        extraLines.push(raw);
        return;
      }
      queue.push({ raw, message });
      pump();
    },
    start() {
      if (started) return;
      if (!deliver) throw new Error('protocol replay: call onServerLine before start');
      started = true;
      checkDone();
      pump();
    },
    pauseBefore: matcher => arm('pause', matcher),
    awaitingClient: matcher => arm('await', matcher),
    resume() {
      if (!paused) return;
      paused = false;
      if (failed) return;
      // The frame at the cursor already passed its breakpoint check; deliver it.
      released = cursor;
      scheduleDelivery(frames[cursor]!, false);
    },
    done,
    unmatchedClientLines() {
      return [...extraLines, ...queue.map(line => line.raw)];
    },
  };
}
