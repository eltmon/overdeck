import { describe, expect, it } from 'vitest';

import { TERMINAL_CONTROL_PREFIX, parseTerminalControlFrame } from './terminalControlFrames';

describe('parseTerminalControlFrame', () => {
  it('parses a snapshot frame', () => {
    const frame = `${TERMINAL_CONTROL_PREFIX}${JSON.stringify({ type: 'snapshot', cols: 80, rows: 24, data: 'hi' })}`;
    expect(parseTerminalControlFrame(frame)).toEqual({ type: 'snapshot', cols: 80, rows: 24, data: 'hi' });
  });

  it('parses a size frame', () => {
    const frame = `${TERMINAL_CONTROL_PREFIX}${JSON.stringify({ type: 'size', cols: 100, rows: 40 })}`;
    expect(parseTerminalControlFrame(frame)).toEqual({ type: 'size', cols: 100, rows: 40 });
  });

  it('returns null for malformed JSON', () => {
    expect(parseTerminalControlFrame(`${TERMINAL_CONTROL_PREFIX}{not json`)).toBeNull();
  });

  it('returns null for a primitive JSON value, so a PTY chunk falls through (PAN-4434)', () => {
    expect(parseTerminalControlFrame(`${TERMINAL_CONTROL_PREFIX}1`)).toBeNull();
    expect(parseTerminalControlFrame(`${TERMINAL_CONTROL_PREFIX}"x"`)).toBeNull();
    expect(parseTerminalControlFrame(`${TERMINAL_CONTROL_PREFIX}null`)).toBeNull();
  });
});
