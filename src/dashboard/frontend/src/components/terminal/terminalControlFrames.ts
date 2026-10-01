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

/** Parse a frame that starts with TERMINAL_CONTROL_PREFIX; null when the JSON is malformed. */
export function parseTerminalControlFrame(dataStr: string): TerminalControlFrame | null {
  try {
    return JSON.parse(dataStr.slice(TERMINAL_CONTROL_PREFIX.length)) as TerminalControlFrame;
  } catch {
    return null;
  }
}
