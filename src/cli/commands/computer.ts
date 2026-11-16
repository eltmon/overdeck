/**
 * `pan computer <sub>` (PAN-5452): let agents read and operate local desktop
 * apps through the vendored Orca helper. See `configuration/computer-use.mdx`
 * and `.pan/drafts/pan-5452.md` for the full design. Opt-in
 * (`computer_use.enabled`), Linux only. Implementations load lazily from
 * `src/lib/computer-use/` inside each action, modeled on `semgrep.ts`.
 */
import type { Command } from 'commander';
import { Option } from 'commander';
import type { RunComputerOperationResult } from '../../lib/computer-use/run.js';

function intOption(flagName: string) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new Error(`${flagName} must be an integer (got: ${value})`);
    return parsed;
  };
}

interface ActionFlags {
  windowIndex?: number;
  restoreWindow?: boolean;
  noScreenshot?: boolean;
  json?: boolean;
}

function addActionOptions(cmd: Command): Command {
  return cmd
    .option('--window-index <n>', 'Window index (default: the first window)', intOption('--window-index'))
    .option('--restore-window', 'Bring the window forward first')
    .option('--no-screenshot', 'Skip taking a screenshot');
}

function addJsonOption(cmd: Command): Command {
  return cmd.option('--json', 'Print a stable JSON shape instead of text');
}

async function printResult(result: RunComputerOperationResult, json?: boolean): Promise<void> {
  const { renderResultJson, renderResultText } = await import('../../lib/computer-use/format.js');
  const response = result.response as Record<string, unknown>;
  const input = {
    action: response.action as Parameters<typeof renderResultJson>[0]['action'],
    ...(response.snapshot
      ? { snapshot: response.snapshot as Parameters<typeof renderResultJson>[0]['snapshot'], screenshot: result.screenshot }
      : {}),
    apps: response.apps as Parameters<typeof renderResultJson>[0]['apps'],
    windows: response.windows as Parameters<typeof renderResultJson>[0]['windows'],
  };
  console.log(json ? JSON.stringify(renderResultJson(input)) : renderResultText(input));
}

async function printError(error: unknown, json?: boolean): Promise<void> {
  const { ComputerUseError, isComputerUseError } = await import('../../lib/computer-use/errors.js');
  const { renderErrorJson, renderErrorText } = await import('../../lib/computer-use/format.js');
  const cuError = isComputerUseError(error)
    ? error
    : new ComputerUseError('helper_error', error instanceof Error ? error.message : String(error));
  if (json) console.log(JSON.stringify(renderErrorJson(cuError)));
  else console.error(renderErrorText(cuError));
  const { exitCli } = await import('../exit.js');
  await exitCli(1);
}

async function run(json: boolean | undefined, fn: () => Promise<RunComputerOperationResult>): Promise<void> {
  try {
    await printResult(await fn(), json);
  } catch (error) {
    await printError(error, json);
  }
}

export function registerComputerCommands(program: Command): void {
  const computer = program.command('computer').description('Let agents read and operate local desktop apps (opt-in, Linux)');

  addJsonOption(computer.command('capabilities').description('Report platform, opt-in and desktop-session readiness')).action(
    async (options: { json?: boolean }) => {
      try {
        const { runCapabilities } = await import('../../lib/computer-use/run.js');
        const { renderResultJson, renderResultText } = await import('../../lib/computer-use/format.js');
        const capabilities = await runCapabilities();
        console.log(options.json ? JSON.stringify(renderResultJson({ capabilities })) : renderResultText({ capabilities }));
      } catch (error) {
        await printError(error, options.json);
      }
    },
  );

  addJsonOption(computer.command('list-apps').description('List open apps with windows')).action(async (options: { json?: boolean }) => {
    await run(options.json, async () => {
      const { listApps } = await import('../../lib/computer-use/commands.js');
      return listApps();
    });
  });

  addJsonOption(computer.command('list-windows').requiredOption('--app <app>', 'App name, or pid:<n>').description('List an app\'s windows')).action(
    async (options: { app: string; json?: boolean }) => {
      await run(options.json, async () => {
        const { listWindows } = await import('../../lib/computer-use/commands.js');
        return listWindows({ app: options.app });
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('get-app-state')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--element-index <n>', 'Read this cached element as a subtree root', intOption('--element-index'))
        .option('--query <text>', 'Keep only tree lines matching this text, plus their ancestors')
        .option('--max-elements <n>', 'Cap the number of matching lines kept by --query', intOption('--max-elements'))
        .description('Read an app window\'s accessibility tree and screenshot'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex?: number;
      query?: string;
      maxElements?: number;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { getAppState } = await import('../../lib/computer-use/commands.js');
        return getAppState(options);
      });
    },
  );

  addJsonOption(
    computer
      .command('wait')
      .requiredOption('--app <app>', 'App name, or pid:<n>')
      .option('--text <t>', 'Succeed once a tree line contains this text')
      .option('--enabled <t>', 'Succeed once a line containing this text is no longer marked disabled')
      .option('--window-title <t>', 'Succeed once a window title contains this text')
      .option('--timeout <ms>', 'Give up after this many milliseconds (default 10000, max 120000)', intOption('--timeout'))
      .description('Poll app state until a text, enabled or window-title condition holds'),
  ).action(
    async (options: { app: string; text?: string; enabled?: string; windowTitle?: string; timeout?: number; json?: boolean }) => {
      try {
        const { waitFor } = await import('../../lib/computer-use/wait.js');
        const { renderResultJson, renderResultText } = await import('../../lib/computer-use/format.js');
        const matches = await waitFor({
          app: options.app,
          text: options.text,
          enabled: options.enabled,
          windowTitle: options.windowTitle,
          timeoutMs: options.timeout,
        });
        console.log(options.json ? JSON.stringify(renderResultJson({ matches })) : renderResultText({ matches }));
      } catch (error) {
        await printError(error, options.json);
      }
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('click')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--element-index <n>', 'Cached element to click', intOption('--element-index'))
        .option('--x <n>', 'Window-local x coordinate', intOption('--x'))
        .option('--y <n>', 'Window-local y coordinate', intOption('--y'))
        .addOption(new Option('--mouse-button <b>', 'Mouse button').choices(['left', 'right', 'middle']))
        .option('--click-count <n>', 'Clicks (2 for a double-click)', intOption('--click-count'))
        .option('--modifiers <chord>', 'Modifier keys held during the click, e.g. shift')
        .description('Click an element or a window-local coordinate'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex?: number;
      x?: number;
      y?: number;
      mouseButton?: 'left' | 'right' | 'middle';
      clickCount?: number;
      modifiers?: string;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { click } = await import('../../lib/computer-use/commands.js');
        return click(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('perform-secondary-action')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .requiredOption('--element-index <n>', 'Cached element', intOption('--element-index'))
        .requiredOption('--action <name>', 'Secondary action name, from the element\'s accessibility actions')
        .description('Run one of an element\'s secondary accessibility actions'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex: number;
      action: string;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { performSecondaryAction } = await import('../../lib/computer-use/commands.js');
        return performSecondaryAction(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('set-value')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .requiredOption('--element-index <n>', 'Cached element', intOption('--element-index'))
        .option('--value <v>', 'New value')
        .option('--value-stdin', 'Read the new value from stdin, instead of argv')
        .description('Set an element\'s value directly through accessibility'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex: number;
      value?: string;
      valueStdin?: boolean;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { setValue } = await import('../../lib/computer-use/commands.js');
        return setValue(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('type-text')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--element-index <n>', 'Element to type into (default: the focused element)', intOption('--element-index'))
        .option('--text <t>', 'Text to type')
        .option('--text-stdin', 'Read the text to type from stdin, instead of argv')
        .description('Type text at an element or the current focus'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex?: number;
      text?: string;
      textStdin?: boolean;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { typeText } = await import('../../lib/computer-use/commands.js');
        return typeText(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('press-key')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .requiredOption('--key <key>', 'Single key, e.g. Return')
        .option('--allow-system-shortcut', 'Allow a key that would quit, lock, log out or switch VTs')
        .description('Press a single key'),
    ),
  ).action(
    async (options: {
      app: string;
      key: string;
      allowSystemShortcut?: boolean;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { pressKey } = await import('../../lib/computer-use/commands.js');
        return pressKey(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('hotkey')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .requiredOption('--key <chord>', 'Key chord, e.g. ctrl+shift+p')
        .option('--allow-system-shortcut', 'Allow a chord that would quit, lock, log out or switch VTs')
        .description('Press a key chord'),
    ),
  ).action(
    async (options: {
      app: string;
      key: string;
      allowSystemShortcut?: boolean;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { hotkey } = await import('../../lib/computer-use/commands.js');
        return hotkey(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('paste-text')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--text <t>', 'Text to paste')
        .option('--text-stdin', 'Read the text to paste from stdin, instead of argv')
        .description('Paste text at the current focus (clipboard, with a synthetic-input fallback)'),
    ),
  ).action(
    async (options: {
      app: string;
      text?: string;
      textStdin?: boolean;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { pasteText } = await import('../../lib/computer-use/commands.js');
        return pasteText(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('scroll')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--element-index <n>', 'Element to scroll', intOption('--element-index'))
        .option('--x <n>', 'Window-local x coordinate', intOption('--x'))
        .option('--y <n>', 'Window-local y coordinate', intOption('--y'))
        .addOption(new Option('--direction <d>', 'Scroll direction').choices(['up', 'down', 'left', 'right']).makeOptionMandatory())
        .option('--pages <n>', 'Number of pages/wheel steps', intOption('--pages'))
        .description('Scroll at an element or a window-local coordinate'),
    ),
  ).action(
    async (options: {
      app: string;
      elementIndex?: number;
      x?: number;
      y?: number;
      direction: 'up' | 'down' | 'left' | 'right';
      pages?: number;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { scroll } = await import('../../lib/computer-use/commands.js');
        return scroll(options);
      });
    },
  );

  addJsonOption(
    addActionOptions(
      computer
        .command('drag')
        .requiredOption('--app <app>', 'App name, or pid:<n>')
        .option('--from-element-index <n>', 'Drag start: cached element', intOption('--from-element-index'))
        .option('--to-element-index <n>', 'Drag end: cached element', intOption('--to-element-index'))
        .option('--from-x <n>', 'Drag start: window-local x', intOption('--from-x'))
        .option('--from-y <n>', 'Drag start: window-local y', intOption('--from-y'))
        .option('--to-x <n>', 'Drag end: window-local x', intOption('--to-x'))
        .option('--to-y <n>', 'Drag end: window-local y', intOption('--to-y'))
        .description('Drag from one element or coordinate to another'),
    ),
  ).action(
    async (options: {
      app: string;
      fromElementIndex?: number;
      toElementIndex?: number;
      fromX?: number;
      fromY?: number;
      toX?: number;
      toY?: number;
      windowIndex?: number;
      restoreWindow?: boolean;
      noScreenshot?: boolean;
      json?: boolean;
    }) => {
      await run(options.json, async () => {
        const { drag } = await import('../../lib/computer-use/commands.js');
        return drag(options);
      });
    },
  );

  addJsonOption(computer.command('release').option('--force', 'Release even a lease held by another holder').description('Release the desktop lease')).action(
    async (options: { force?: boolean; json?: boolean }) => {
      try {
        const { runRelease } = await import('../../lib/computer-use/run.js');
        await runRelease({ force: options.force });
        console.log(options.json ? JSON.stringify({ ok: true }) : 'Desktop lease released.');
      } catch (error) {
        await printError(error, options.json);
      }
    },
  );
}
