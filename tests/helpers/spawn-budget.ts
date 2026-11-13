/**
 * Spawn ledger: count child-process spawns at the `node:child_process`
 * boundary, and deny host tools a bare host does not have (PAN-5176).
 *
 * The ledger wraps the six spawn functions of the real builtin (`spawn`,
 * `execFile`, `exec`, `spawnSync`, `execFileSync`, `execSync`) and then calls
 * `syncBuiltinESMExports()`, so it sees calls from vite-inlined `src` modules,
 * from externalized `node_modules` (Effect's `NodeServices.layer` spawner),
 * and from `promisify(execFile)` / `promisify(exec)`. A nested call (for
 * example `exec` calling `execFile` inside Node) is recorded once.
 *
 * Calls whose program basename is in the deny list (default
 * `DENIED_HOST_TOOLS`) are recorded with `denied: true` and redirected to
 * `/nonexistent/overdeck-spawn-budget/<tool>`. The direct forms then fail with
 * a real ENOENT in every calling style. A shell form (`exec`, `execSync`,
 * `shell: true`) is denied when any word of its command names a denied tool,
 * and the whole command is replaced, so the shell exits 127. A regression therefore never runs the machine's
 * real `docker` or `tmux`. All other calls pass through and are still recorded.
 *
 * Rules for a test file that uses the ledger:
 *
 * 1. Install it in `vi.hoisted`, before the subject is imported. Modules
 *    capture `promisify(execFile)` at load time, and a ledger installed in
 *    `beforeAll` silently misses those captures.
 *
 *    ```ts
 *    const ledger = await vi.hoisted(async () =>
 *      (await import('../../helpers/spawn-budget.js')).installSpawnLedger());
 *    ```
 *
 * 2. Do not `vi.mock('node:child_process')` or `vi.mock('child_process')` in
 *    the same file: the mock replaces the builtin the ledger wraps.
 *
 * 3. Call `ledger.restore()` in `afterAll`. The builtin is shared by every
 *    test file that runs in the same worker process.
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect } from 'vitest';

export type SpawnApi = 'spawn' | 'execFile' | 'exec' | 'spawnSync' | 'execFileSync' | 'execSync';

export interface SpawnRecord {
  readonly api: SpawnApi;
  /** Basename of the program, e.g. `tmux` for `/usr/bin/tmux`. */
  readonly program: string;
  readonly denied: boolean;
}

export const DENIED_HOST_TOOLS = ['docker', 'tmux', 'systemctl', 'journalctl', 'brew'] as const;

export interface SpawnLedger {
  readonly records: readonly SpawnRecord[];
  count(filter?: { programs?: readonly string[] }): number;
  reset(): void;
  /** Puts the original functions back and calls `syncBuiltinESMExports()`. */
  restore(): void;
}

const SPAWN_APIS: readonly SpawnApi[] = ['spawn', 'execFile', 'exec', 'spawnSync', 'execFileSync', 'execSync'];
/** APIs whose first argument is always a shell command string. */
const SHELL_APIS: ReadonlySet<SpawnApi> = new Set(['exec', 'execSync']);
const DENY_DIR = '/nonexistent/overdeck-spawn-budget';
const ACTIVE_KEY = Symbol.for('overdeck.spawnLedger.active');

type AnyFn = (...args: unknown[]) => unknown;
type ChildProcessModule = Record<SpawnApi, AnyFn>;

function optionsArg(args: readonly unknown[]): Record<string, unknown> | undefined {
  // spawn/execFile/spawnSync/execFileSync take (file, args?, options?, cb?).
  for (const arg of args.slice(1, 3)) {
    if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) return arg as Record<string, unknown>;
  }
  return undefined;
}

function usesShell(api: SpawnApi, args: readonly unknown[]): boolean {
  return SHELL_APIS.has(api) || Boolean(optionsArg(args)?.['shell']);
}

/** Every word of a shell command, split at whitespace and shell operators, with quotes removed. */
function shellWords(command: string): string[] {
  return command
    .split(/[\s;&|()<>`$]+/)
    .map((word) => word.replace(/['"\\]/g, ''))
    .filter((word) => word.length > 0);
}

export function installSpawnLedger(options?: { deny?: readonly string[] }): SpawnLedger {
  const registry = globalThis as Record<symbol, unknown>;
  if (registry[ACTIVE_KEY]) {
    throw new Error('A spawn ledger is already installed in this process; call ledger.restore() in afterAll.');
  }

  const deny = new Set(options?.deny ?? DENIED_HOST_TOOLS);
  const cp = createRequire(import.meta.url)('node:child_process') as ChildProcessModule;
  const originals = new Map<SpawnApi, AnyFn>();
  const records: SpawnRecord[] = [];
  let depth = 0;
  let active = true;

  /** Records the call (outermost only) and returns the args to pass on. */
  const intercept = (api: SpawnApi, args: unknown[]): unknown[] => {
    if (!active || depth > 0) return args;
    const shell = usesShell(api, args);
    const target = String(args[0] ?? '');
    // A shell command is denied when ANY of its words names a denied tool
    // (`true && tmux -V`, `"tmux" -V`, `FOO=1 docker ps`): the first word
    // alone would let a compound command run the real binary.
    const words = shell ? shellWords(target).map((word) => path.basename(word)) : [path.basename(target)];
    const deniedWord = words.find((word) => deny.has(word));
    const program = deniedWord ?? words[0] ?? '';
    const denied = deniedWord !== undefined;
    records.push({ api, program, denied });
    if (!denied) return args;
    // A denied shell command is replaced whole, so no part of it runs and the
    // shell exits 127; a direct call gets a real ENOENT.
    const next = [...args];
    next[0] = `${DENY_DIR}/${program}`;
    return next;
  };

  const wrap = (api: SpawnApi, original: AnyFn): AnyFn => function (this: unknown, ...args: unknown[]) {
    const nextArgs = intercept(api, args);
    depth += 1;
    try {
      return original.apply(this, nextArgs);
    } finally {
      depth -= 1;
    }
  };

  for (const api of SPAWN_APIS) {
    const original = cp[api];
    originals.set(api, original);
    const wrapper = wrap(api, original);
    // Copying the original's promisify.custom would bypass the ledger: Node's
    // custom function calls its internal execFile/exec directly. Wrap it too.
    const custom = (original as unknown as Record<symbol, AnyFn | undefined>)[promisify.custom];
    if (custom) {
      Object.defineProperty(wrapper, promisify.custom, { value: wrap(api, custom), configurable: true });
    }
    cp[api] = wrapper;
  }
  syncBuiltinESMExports();
  registry[ACTIVE_KEY] = true;

  return {
    get records() {
      return records;
    },
    count(filter) {
      const programs = filter?.programs;
      if (!programs) return records.length;
      return records.filter((record) => programs.includes(record.program)).length;
    },
    reset() {
      records.length = 0;
    },
    restore() {
      if (!active) return;
      active = false;
      for (const [api, original] of originals) cp[api] = original;
      syncBuiltinESMExports();
      delete registry[ACTIVE_KEY];
    },
  };
}

/**
 * Runs `tick` `opts.ticks` times and returns the ledger count of each tick.
 * It does not catch: a rejecting tick rejects this call, so a poller that
 * breaks before it reaches `child_process` fails the test instead of
 * reporting 0 spawns.
 */
export async function spawnsPerTick(
  ledger: SpawnLedger,
  tick: () => unknown,
  opts: { ticks: number; betweenTicks?: () => Promise<void>; programs?: readonly string[] },
): Promise<number[]> {
  const perTick: number[] = [];
  for (let index = 0; index < opts.ticks; index += 1) {
    if (index > 0) await opts.betweenTicks?.();
    ledger.reset();
    await tick();
    perTick.push(ledger.count({ programs: opts.programs }));
  }
  return perTick;
}

export function expectSpawnBudget(perTick: readonly number[], budget: { max: number; label: string }): void {
  perTick.forEach((spawns, index) => {
    expect(spawns, `${budget.label}: tick ${index} spawned ${spawns}, budget ${budget.max}`)
      .toBeLessThanOrEqual(budget.max);
  });
}
