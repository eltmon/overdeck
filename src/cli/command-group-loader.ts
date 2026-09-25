/**
 * On-demand registration for command groups (PAN-4195).
 *
 * A command group is a module whose registration function sits beside heavy
 * implementation imports. A loader registers each group at its place in the
 * caller's registration order, but only when argv invokes one of the group's
 * names. Help, a bare parent command and any name nothing claims register
 * every group in order, so help output and unknown-command errors stay
 * byte-identical to eager registration.
 */
import type { Command } from 'commander';

/** Which groups argv needs: every group, none, or the one owning `name`. */
export type GroupDemand = 'all' | 'none' | { readonly name: string };

export interface CommandGroup<M = unknown> {
  /** Every name and alias the group registers under its parent. */
  readonly names: readonly string[];
  readonly load: () => Promise<M>;
  /** `demand` is the parent loader's, for groups that nest their own loader. */
  readonly register: (mod: M, parent: Command, demand: GroupDemand) => void | Promise<void>;
}

/** Any group, its module type erased: what a loader's table holds. */
export interface ErasedCommandGroup {
  readonly names: readonly string[];
  readonly load: () => Promise<unknown>;
  readonly register: (mod: never, parent: Command, demand: GroupDemand) => void | Promise<void>;
}

/** Ties an entry's `register` to the module type its `load` returns. */
export function group<M>(entry: CommandGroup<M>): CommandGroup<M> {
  return entry;
}

/**
 * The demand at the level below `parentPath` (`[]` for top-level commands).
 * Root options other than `-V/--version` and the help flags take no value
 * (`--yolo` is stripped before Commander runs).
 */
export function resolveGroupDemand(argv: readonly string[], parentPath: readonly string[] = []): GroupDemand {
  const tokens = argv.slice(2);
  let depth = 0;
  let sawHelpCommand = false;
  for (const [index, token] of tokens.entries()) {
    if (depth === 0 && !sawHelpCommand && (token === '-V' || token === '--version')) return 'none';
    if (token.startsWith('-')) return 'all';
    if (token === 'help' && !sawHelpCommand) {
      sawHelpCommand = true;
      continue;
    }
    if (depth < parentPath.length) {
      // `pan help admin db` shows admin's own help, which lists every subcommand.
      if (sawHelpCommand || token !== parentPath[depth]) return 'all';
      depth += 1;
      continue;
    }
    // `pan admin commands` introspects the whole command tree.
    if (depth === 0 && token === 'admin' && tokens[index + 1] === 'commands') return 'all';
    return { name: token };
  }
  return 'all';
}

export class CommandGroupLoader<Key extends string> {
  private readonly skipped: Key[] = [];
  private readonly prefetched = new Map<Key, Promise<unknown>>();

  constructor(
    private readonly parent: Command,
    private readonly demand: GroupDemand,
    private readonly groups: Readonly<Record<Key, ErasedCommandGroup>>,
  ) {
    if (demand === 'all') {
      // Every group will register: start all module loads at once.
      for (const key of Object.keys(groups) as Key[]) {
        const pending = this.entry(key).load();
        // Surfaced by register(); this only stops an early unhandled rejection.
        pending.catch(() => {});
        this.prefetched.set(key, pending);
      }
    }
  }

  async register(key: Key): Promise<void> {
    const entry = this.entry(key);
    const { demand } = this;
    if (demand === 'all' || (demand !== 'none' && entry.names.includes(demand.name))) {
      await entry.register(await (this.prefetched.get(key) ?? entry.load()), this.parent, demand);
    } else {
      this.skipped.push(key);
    }
  }

  /** Registers every skipped group when the invoked name matched no command. */
  async finish(): Promise<void> {
    const { demand } = this;
    if (typeof demand !== 'object') return;
    const matched = this.parent.commands.some((command) =>
      command.name() === demand.name || command.aliases().includes(demand.name));
    if (matched) return;
    for (const key of this.skipped.splice(0)) {
      const entry = this.entry(key);
      await entry.register(await entry.load(), this.parent, 'all');
    }
  }

  private entry(key: Key): CommandGroup {
    return this.groups[key] as CommandGroup;
  }
}
