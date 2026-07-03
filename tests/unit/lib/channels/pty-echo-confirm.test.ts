import { describe, it, expect } from 'vitest';
import { isEchoConfirmed, confirmationPrefix } from '../../../../src/lib/channels/pty-supervisor.js';

describe('pty-supervisor echo confirmation', () => {
  it('confirms when the trailing-line prefix echoes back verbatim', () => {
    const content = 'line one\nfinal instruction line to confirm';
    const prefix = confirmationPrefix(content);
    expect(isEchoConfirmed('… final instruction line to confirm', prefix)).toBe(true);
  });

  it('confirms a collapsed paste placeholder even when box-draw glyphs split "Pasted text"', () => {
    // A large kickoff prompt collapses to a placeholder rendered inside the
    // bordered composer; box glyphs and wrapping sit between the words so the
    // literal "[Pasted text " never appears in stripAnsi output.
    const prefix = confirmationPrefix('a very long swarm dispatch prompt line to confirm');
    const composerRender = '│ [Pasted text │\n│ #1 +55 lines] │';
    expect(isEchoConfirmed(composerRender, prefix)).toBe(true);
  });

  it('confirms the exact real-world failure tail that wedged slot kickoff', () => {
    const prefix = confirmationPrefix('some 7000-character kickoff prompt whose tail never echoes raw');
    // Reproduced from pty-supervisor-agent-pan-1791-slot-22.log echo_confirm_failed tail.
    const observed = '(B [Pasted text #1 +55 lines] paste again to expand [Pasted text #2 +55 lines]';
    expect(isEchoConfirmed(observed, prefix)).toBe(true);
  });

  it('does not confirm when neither the prefix nor a placeholder is present', () => {
    const prefix = confirmationPrefix('expected trailing content to confirm');
    expect(isEchoConfirmed('unrelated spinner frames and a status bar', prefix)).toBe(false);
  });

  it('treats an empty prefix as trivially confirmed', () => {
    expect(isEchoConfirmed('anything at all', '')).toBe(true);
  });
});
