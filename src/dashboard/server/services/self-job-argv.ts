/**
 * The closed set of `pan` verbs a self job may run, and the one builder for a
 * job's argv (PAN-4927 W-SELF1, D-11, D-4).
 *
 * A job runs `pan` with the dashboard user's rights (epic H-7), so argv
 * construction is the security boundary. Each verb has a fixed prefix of verb
 * words only; caller text reaches argv only through the typed `SelfJobArg`
 * pieces, each validated here, so it can never land before the prefix or as
 * an element `pan` would read as a flag. Flags and positionals per verb stay
 * with the route item that adds the verb. This module imports nothing.
 */

/** Every pan verb a self route may run, with its fixed argv prefix. A verb not here cannot run. */
export const SELF_JOB_VERBS = {
  'task-claim': ['task', 'claim'],
  'task-done': ['task', 'done'],
  'task-block': ['task', 'block'],
  done: ['done'],
  handoff: ['handoff'],
  'worker-report': ['worker', 'report'],
  'lane-report': ['lane', 'report'],
  'memory-add': ['memory', 'add'],
  'memory-search': ['memory', 'search'],
} as const satisfies Record<string, readonly string[]>;
export type SelfJobVerb = keyof typeof SELF_JOB_VERBS;

/**
 * One argv piece after the prefix. Caller text reaches argv only through these:
 * `ref` — an id or ref positional, must match SELF_JOB_REF_PATTERN (never starts with '-');
 * `flag` — one `--<flag>=<value>` token; `flag` is a literal the route writes, `value` may be any text;
 * `switch` — a bare `--<switch>` literal such as 'json' or 'stdin';
 * `rest` — positionals after a single `--`; only as the last piece.
 */
export type SelfJobArg = { ref: string } | { flag: string; value: string } | { switch: string } | { rest: readonly string[] };

/** H-6: the first character excludes '-', so a ref is never read as a flag. */
export const SELF_JOB_REF_PATTERN = /^[A-Za-z0-9#][A-Za-z0-9#/:._-]{0,199}$/;
const FLAG_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

export class SelfJobArgError extends Error {
  readonly code = 'bad-job-arg';
}

function assertFlagName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !FLAG_NAME_PATTERN.test(name)) {
    throw new SelfJobArgError(`invalid flag name: ${String(name).slice(0, 40)}`);
  }
}

function assertText(value: unknown, what: string): asserts value is string {
  if (typeof value !== 'string' || value.includes('\0')) throw new SelfJobArgError(`invalid ${what} value`);
}

/** The full argv for `verb` (prefix first). Throws SelfJobArgError on any invalid piece. */
export function buildSelfJobArgv(verb: SelfJobVerb, args: readonly SelfJobArg[] = []): string[] {
  if (!Object.hasOwn(SELF_JOB_VERBS, verb)) throw new SelfJobArgError(`unknown job verb ${String(verb).slice(0, 40)}`);
  const argv: string[] = [...SELF_JOB_VERBS[verb]];
  args.forEach((arg, index) => {
    if ('ref' in arg) {
      if (typeof arg.ref !== 'string' || !SELF_JOB_REF_PATTERN.test(arg.ref)) {
        throw new SelfJobArgError(`invalid id or ref: ${String(arg.ref).slice(0, 40)}`);
      }
      argv.push(arg.ref);
    } else if ('flag' in arg) {
      assertFlagName(arg.flag);
      assertText(arg.value, `--${arg.flag}`);
      argv.push(`--${arg.flag}=${arg.value}`);
    } else if ('switch' in arg) {
      assertFlagName(arg.switch);
      argv.push(`--${arg.switch}`);
    } else if ('rest' in arg) {
      if (index !== args.length - 1) throw new SelfJobArgError('rest must be the last job argument');
      for (const value of arg.rest) assertText(value, 'rest');
      argv.push('--', ...arg.rest);
    } else {
      throw new SelfJobArgError('unknown job argument');
    }
  });
  return argv;
}
