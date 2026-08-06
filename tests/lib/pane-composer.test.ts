import { describe, expect, it } from 'vitest';
import { activeComposerPayloadPresence } from '../../src/lib/pane-composer.js';

describe('activeComposerPayloadPresence', () => {
  it('finds a delivered payload at the cursor-anchored composer', () => {
    const viewport = {
      text: [
        'older terminal output',
        '───────────────────────────── agent-pan-3422 ──',
        '❯ verification feedback is waiting here',
        'usage 21% · cost $25.00',
      ].join('\n'),
      cursorY: 2,
    };

    expect(activeComposerPayloadPresence(viewport, 'verification feedback is waiting here'))
      .toBe('present');
  });

  it('does not mistake submitted transcript output above an empty composer for pending input', () => {
    const viewport = {
      text: [
        'verification feedback is waiting here',
        'older terminal output',
        '───────────────────────────── agent-pan-3422 ──',
        '❯ ',
        'usage 21% · cost $25.00',
      ].join('\n'),
      cursorY: 3,
    };

    expect(activeComposerPayloadPresence(viewport, 'verification feedback is waiting here'))
      .toBe('absent');
  });
});
