import { describe, expect, it } from 'vitest';

import { observedEffortFromRecord, parseEffortCommandStdout } from '../claude-effort-transcript.js';

// Literal transcript strings from Claude Code 2.1.284 (PAN-4255 PRD, Empirical facts).
const LOW_STDOUT =
  '<local-command-stdout>Set effort level to low (saved as your default for new sessions): Quick, straightforward implementation</local-command-stdout>';
const MAX_STDOUT =
  '<local-command-stdout>Set effort level to max (this session only): Deepest reasoning</local-command-stdout>';
const BOGUS_STDOUT =
  '<local-command-stdout>Invalid argument: bogus. Valid options are: low, medium, high, xhigh, max, auto, ultracode [on|off]</local-command-stdout>';
const COMMAND_RECORD =
  '<command-name>/effort</command-name>\n            <command-message>effort</command-message>\n            <command-args>low</command-args>';

describe('parseEffortCommandStdout', () => {
  it.each([
    ['low confirmation', LOW_STDOUT, { kind: 'set', level: 'low' }],
    ['max confirmation', MAX_STDOUT, { kind: 'set', level: 'max' }],
    [
      'invalid argument',
      BOGUS_STDOUT,
      {
        kind: 'rejected',
        message: 'Invalid argument: bogus. Valid options are: low, medium, high, xhigh, max, auto, ultracode [on|off]',
      },
    ],
    [
      'failed to set',
      '<local-command-stdout>Failed to set effort level: disk full</local-command-stdout>',
      { kind: 'rejected', message: 'Failed to set effort level: disk full' },
    ],
    [
      'not applied',
      '<local-command-stdout>Not applied: CLAUDE_CODE_EFFORT_LEVEL=high</local-command-stdout>',
      { kind: 'rejected', message: 'Not applied: CLAUDE_CODE_EFFORT_LEVEL=high' },
    ],
    ['command record', COMMAND_RECORD, null],
    ['unrelated stdout', '<local-command-stdout>Model set to opus</local-command-stdout>', null],
    ['plain text', 'Set effort level to low', null],
  ])('%s', (_name, content, expected) => {
    expect(parseEffortCommandStdout(content)).toEqual(expected);
  });
});

describe('observedEffortFromRecord', () => {
  it.each([
    ['assistant effort', { type: 'assistant', effort: 'low', perTurnEffort: 'low' }, 'low'],
    ['assistant perTurnEffort only', { type: 'assistant', perTurnEffort: 'xhigh' }, 'xhigh'],
    ['sidechain', { type: 'assistant', effort: 'low', isSidechain: true }, null],
    ['auto effort', { type: 'assistant', effort: 'auto' }, null],
    ['assistant without effort', { type: 'assistant', message: { content: [] } }, null],
    ['user confirmation', { type: 'user', message: { content: LOW_STDOUT } }, 'low'],
    ['user rejection', { type: 'user', message: { content: BOGUS_STDOUT } }, null],
    ['user command record', { type: 'user', message: { content: COMMAND_RECORD } }, null],
    ['user array content', { type: 'user', message: { content: [{ type: 'text', text: LOW_STDOUT }] } }, null],
    ['sidechain confirmation', { type: 'user', isSidechain: true, message: { content: LOW_STDOUT } }, null],
    ['system record', { type: 'system', effort: 'low' }, null],
    ['not an object', 'low', null],
    ['null', null, null],
  ])('%s', (_name, record, expected) => {
    expect(observedEffortFromRecord(record)).toBe(expected);
  });
});
