import { describe, expect, it } from 'vitest';
import { activeComposerPayloadPresence, screenComposerPayloadPresence } from '../../src/lib/pane-composer.js';

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

describe('screenComposerPayloadPresence', () => {
  it('finds a delivered payload in a cursor-less live-capture screen', () => {
    const screen = [
      '✻ Cogitated for 5m 31s · done 12:01 PM',
      '',
      '──────────────────────────────────────────────────────────',
      '❯ yes file it and fix it',
      '──────────────────────────────────────────────────────────',
      '  Opus 5.5 (claude-opus-5-5)  /home/eltmon/Projects/overdeck  main',
      '  ctx 11%  2/1.0M  out 1.0k  cost $1.3849',
      '  5h 6% (3h48m)  7d 2% (74h58m)',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent',
    ].join('\n');

    expect(screenComposerPayloadPresence(screen, 'yes file it and fix it')).toBe('present');
  });

  it('does not mistake scrollback above an empty composer for pending input', () => {
    const screen = [
      'yes file it and fix it',
      '✻ Cogitated for 5m 31s · done 12:01 PM',
      '',
      '──────────────────────────────────────────────────────────',
      '❯ ',
      '──────────────────────────────────────────────────────────',
      '  Opus 5.5 (claude-opus-5-5)  /home/eltmon/Projects/overdeck  main',
      '  ctx 11%  2/1.0M  out 1.0k  cost $1.3849',
      '  5h 6% (3h48m)  7d 2% (74h58m)',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 1 agent',
    ].join('\n');

    expect(screenComposerPayloadPresence(screen, 'yes file it and fix it')).toBe('absent');
  });

  it('treats a paste placeholder in the composer as present', () => {
    const screen = [
      '──────────────────────────────────────────────────────────',
      '❯ [Pasted text #1 +82 lines]',
      '──────────────────────────────────────────────────────────',
      '  Opus 5.5 (claude-opus-5-5)  /home/eltmon/Projects/overdeck  main',
    ].join('\n');

    const content = `soak-${'x'.repeat(5 * 1024)}`;
    expect(screenComposerPayloadPresence(screen, content)).toBe('present');
  });

  it('finds a wrapped payload above a single rule row when the top rule has scrolled off', () => {
    const screen = [
      '❯ please apply the fix across every single file',
      '  in the repository right now',
      '──────────────────────────────────────────────────────────',
      '  Opus 5.5 (claude-opus-5-5)  /home/eltmon/Projects/overdeck  main',
    ].join('\n');

    expect(screenComposerPayloadPresence(screen, 'please apply the fix across every single file in the repository right now'))
      .toBe('present');
  });

  it('is unproven when the screen has no rule rows', () => {
    const screen = [
      '❯ yes file it and fix it',
      '  Opus 5.5 (claude-opus-5-5)  /home/eltmon/Projects/overdeck  main',
    ].join('\n');

    expect(screenComposerPayloadPresence(screen, 'yes file it and fix it')).toBe('unproven');
  });

  it('treats a labelled rule row as a rule boundary', () => {
    const screen = [
      '───────────────────────────── agent-pan-3422 ──',
      '❯ verification feedback is waiting here',
      '───────────────────────────── agent-pan-3422 ──',
      'usage 21% · cost $25.00',
    ].join('\n');

    expect(screenComposerPayloadPresence(screen, 'verification feedback is waiting here')).toBe('present');
  });
});
