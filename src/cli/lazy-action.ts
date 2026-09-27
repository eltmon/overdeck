/**
 * Lazy Commander action handlers (PAN-4195).
 *
 * The CLI registers every command's name, arguments, options and description
 * up front, so `--help` stays complete, but a command's implementation module
 * (and everything it imports) loads only when that command runs. Before this,
 * each `pan` call evaluated every command module: ~0.5 s and ~230 MB just to
 * print `--version`.
 *
 *   program.command('tell <id> <message>')
 *     .action(lazyAction(() => import('./commands/tell.js'), 'tellCommand'));
 *
 * Keep command modules out of the entry's static imports (`import type` is
 * fine); `tests/unit/cli/startup-lazy-load.test.ts` guards the startup graph.
 */

type ActionFn = (...args: never[]) => unknown;
type ActionKeys<M> = { [K in keyof M]: M[K] extends ActionFn ? K : never }[keyof M];

export function lazyAction<M, K extends ActionKeys<M>>(
  load: () => Promise<M>,
  exportName: K,
): (...args: unknown[]) => Promise<void> {
  return async (...args: unknown[]) => {
    const mod = await load();
    await (mod[exportName] as (...actionArgs: unknown[]) => unknown)(...args);
  };
}
