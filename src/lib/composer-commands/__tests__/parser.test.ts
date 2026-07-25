import { describe, expect, it, vi } from 'vitest';
import {
  ComposerCommandParseError,
  parseOverdeckComposerCommand,
} from '../parser.js';

const childProcess = vi.hoisted(() => ({
  exec: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('node:child_process', () => childProcess);

function parseError(input: string): ComposerCommandParseError {
  try {
    parseOverdeckComposerCommand(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ComposerCommandParseError);
    return error as ComposerCommandParseError;
  }
  throw new Error(`Expected parser error for ${input}`);
}

describe('parseOverdeckComposerCommand', () => {
  it('parses commands, quoted values, flags, and aliases into canonical argv', () => {
    expect(parseOverdeckComposerCommand('/pan start PAN-42')).toMatchObject({
      entry: { path: ['start'] },
      argv: ['start', 'PAN-42'],
    });
    expect(parseOverdeckComposerCommand('/pan start "PAN-42" --plan=skip')?.argv).toEqual([
      'start',
      'PAN-42',
      '--plan',
      'skip',
    ]);
    expect(parseOverdeckComposerCommand("/pan start 'PAN-42' --plan skip")?.argv).toEqual([
      'start',
      'PAN-42',
      '--plan',
      'skip',
    ]);
    expect(parseOverdeckComposerCommand('/pan tell PAN-42 "hello world"')?.argv).toEqual([
      'tell',
      'PAN-42',
      'hello world',
    ]);
    expect(parseOverdeckComposerCommand('/pan stop agent-42')?.argv).toEqual([
      'kill',
      'agent-42',
    ]);
    expect(parseOverdeckComposerCommand('/pan conv list')?.argv).toEqual([
      'conversations',
      'list',
    ]);
  });

  it('returns actionable typed validation errors', () => {
    expect(parseError('/pan frobnicate')).toMatchObject({
      code: 'unknown-command',
      token: 'frobnicate',
      expected: '/pan <command>',
    });
    expect(parseError('/pan start')).toMatchObject({
      code: 'missing-argument',
      token: 'id',
    });
    expect(parseError('/pan start PAN-42 --bogus')).toMatchObject({
      code: 'unknown-flag',
      token: '--bogus',
    });
    expect(parseError('/pan start PAN-42 --plan=')).toMatchObject({
      code: 'missing-argument',
      token: '--plan',
    });
    expect(parseError('/pan tell PAN-42 "unterminated')).toMatchObject({
      code: 'missing-argument',
      token: '"',
    });
  });

  it.each([
    '/pan show PAN-42; whoami',
    '/pan show PAN-42 | tee out',
    '/pan show PAN-42 &',
    '/pan show PAN-42 < input',
    '/pan show PAN-42 > output',
    '/pan show `whoami`',
    '/pan show $(whoami)',
  ])('rejects shell syntax without spawning a process: %s', input => {
    expect(parseError(input).code).toBe('forbidden-token');
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it.each([
    'Please run pan start PAN-42',
    'pan start PAN-42',
    '/model',
    '/pan-handoff focus',
    '/panorama',
  ])('returns null for non-control text: %s', input => {
    expect(parseOverdeckComposerCommand(input)).toBeNull();
  });
});
