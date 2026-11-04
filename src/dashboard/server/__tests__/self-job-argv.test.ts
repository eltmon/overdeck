/**
 * PAN-4927 W-SELF1 WI-2: a self job runs only a closed verb with its fixed
 * prefix, and caller text never becomes a flag element before `--`.
 */
import { describe, expect, it } from 'vitest';

import { buildSelfJobArgv, SELF_JOB_VERBS, type SelfJobArg, SelfJobArgError, type SelfJobVerb } from '../services/self-job-argv.js';

const VERBS = Object.keys(SELF_JOB_VERBS) as SelfJobVerb[];

describe('SELF_JOB_VERBS', () => {
  it('holds exactly the nine verbs', () => {
    expect(VERBS).toEqual(['task-claim', 'task-done', 'task-block', 'done', 'handoff', 'worker-report', 'lane-report', 'memory-add', 'memory-search']);
  });

  it.each(VERBS)('%s argv starts with its exact prefix', (verb) => {
    expect(buildSelfJobArgv(verb)).toEqual([...SELF_JOB_VERBS[verb]]);
  });
});

describe('buildSelfJobArgv', () => {
  it('builds refs and switches after the prefix', () => {
    expect(buildSelfJobArgv('task-claim', [{ ref: 'PAN-1' }, { ref: 'item-a' }, { switch: 'json' }])).toEqual(['task', 'claim', 'PAN-1', 'item-a', '--json']);
  });

  it.each(['--steal', '-x', '', 'a'.repeat(201), 'a b'])('refuses the ref %j', (ref) => {
    expect(() => buildSelfJobArgv('task-claim', [{ ref }])).toThrow(SelfJobArgError);
  });

  it('accepts a 200-character ref and refs with #, / and :', () => {
    expect(buildSelfJobArgv('done', [{ ref: 'a'.repeat(200) }])).toHaveLength(2);
    expect(buildSelfJobArgv('task-block', [{ ref: 'PAN-1' }, { ref: 'item' }, { ref: '#12' }])).toEqual(['task', 'block', 'PAN-1', 'item', '#12']);
  });

  it('keeps a flag value inside one --flag=value element', () => {
    expect(buildSelfJobArgv('handoff', [{ flag: 'title', value: '--allow-primary' }])).toEqual(['handoff', '--title=--allow-primary']);
  });

  it.each(['Title', '--x', '', 'a b'])('refuses the flag name %j', (flag) => {
    expect(() => buildSelfJobArgv('handoff', [{ flag, value: 'x' }])).toThrow(SelfJobArgError);
  });

  it('refuses a switch name that is not a plain literal', () => {
    expect(() => buildSelfJobArgv('done', [{ switch: '-x' }])).toThrow(SelfJobArgError);
  });

  it('puts rest values after a single --', () => {
    expect(buildSelfJobArgv('handoff', [{ rest: ['--cwd', '/'] }])).toEqual(['handoff', '--', '--cwd', '/']);
  });

  it('refuses a rest that is not last', () => {
    expect(() => buildSelfJobArgv('handoff', [{ rest: ['a'] }, { switch: 'json' }])).toThrow(SelfJobArgError);
  });

  it('refuses a NUL byte in a flag value or rest value', () => {
    expect(() => buildSelfJobArgv('handoff', [{ flag: 'title', value: 'a\0b' }])).toThrow(SelfJobArgError);
    expect(() => buildSelfJobArgv('handoff', [{ rest: ['a\0b'] }])).toThrow(SelfJobArgError);
  });

  it('refuses an unknown verb', () => {
    expect(() => buildSelfJobArgv('rm' as SelfJobVerb)).toThrow(SelfJobArgError);
    expect(() => buildSelfJobArgv('toString' as SelfJobVerb)).toThrow(SelfJobArgError);
  });

  it('refuses an argument of no known shape', () => {
    expect(() => buildSelfJobArgv('done', [{ other: 'x' } as unknown as SelfJobArg])).toThrow(SelfJobArgError);
  });

  describe('a hostile caller string never becomes a flag before --', () => {
    const hostile = '--allow-primary';
    const placements: Array<[string, SelfJobArg]> = [
      ['ref', { ref: hostile }],
      ['flag value', { flag: 'title', value: hostile }],
      ['flag name', { flag: hostile, value: 'x' }],
      ['switch', { switch: hostile }],
      ['rest', { rest: [hostile] }],
    ];

    for (const verb of VERBS) {
      it.each(placements)(`${verb}: through %s`, (_label, arg) => {
        let argv: string[];
        try {
          argv = buildSelfJobArgv(verb, [arg]);
        } catch (error) {
          expect(error).toBeInstanceOf(SelfJobArgError);
          return;
        }
        const prefix = SELF_JOB_VERBS[verb];
        expect(argv.slice(0, prefix.length)).toEqual([...prefix]);
        const separator = argv.indexOf('--');
        argv.forEach((element, index) => {
          if (element === hostile) expect(separator !== -1 && index > separator).toBe(true);
        });
      });
    }
  });
});
