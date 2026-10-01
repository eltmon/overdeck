/**
 * /ws/terminal control frames (server → client): a NUL-prefixed JSON object.
 * Extracted from XTerminal.tsx (PAN-4434) so the component stays under its
 * file-size cap.
 */
export const TERMINAL_CONTROL_PREFIX = '\u0000';

export interface TerminalSnapshotMessage {
  type: 'snapshot';
  cols: number;
  rows: number;
  data: string;
}

export interface TerminalSizeMessage {
  type: 'size';
  cols: number;
  rows: number;
}

export interface TerminalPingMessage {
  type: 'ping';
}
/** The client's answer to a ping frame (PAN-4434). */
export const TERMINAL_PONG_MESSAGE = JSON.stringify({ type: 'pong' });

export type TerminalControlFrame = TerminalSnapshotMessage | TerminalSizeMessage | TerminalPingMessage;

/**
 * Parse a frame that starts with TERMINAL_CONTROL_PREFIX; null when the JSON is
 * malformed or parses to anything but an object (e.g. a bare number or string),
 * so a PTY chunk that happens to begin with NUL still falls through to xterm (PAN-4434).
 */
export function parseTerminalControlFrame(dataStr: string): TerminalControlFrame | null {
  try {
    const parsed: unknown = JSON.parse(dataStr.slice(TERMINAL_CONTROL_PREFIX.length));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as TerminalControlFrame;
  } catch {
    return null;
  }
}
