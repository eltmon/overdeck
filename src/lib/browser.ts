/**
 * Cross-platform browser opener.
 * Used by `npx panopticon serve` to open the dashboard URL after server starts.
 */

import { Effect } from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner';
import { ProcessSpawnError } from './errors.js';

function runCommand(
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<void, ProcessSpawnError, ChildProcessSpawner> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    const code = yield* spawner
      .exitCode(ChildProcess.make(command, args, { stdout: 'ignore', stderr: 'ignore' }))
      .pipe(Effect.mapError((e) => new ProcessSpawnError({ command, args, message: e.message, cause: e })));
    if (Number(code) !== 0) {
      yield* Effect.fail(new ProcessSpawnError({ command, args, message: `exited with code ${String(code)}` }));
    }
  });
}

export function openBrowser(url: string): Effect.Effect<void, ProcessSpawnError, ChildProcessSpawner> {
  if (process.platform === 'darwin') {
    return runCommand('open', [url]);
  } else if (process.platform === 'win32') {
    // cmd.exe /c start is the standard way; /b runs without a new window
    return runCommand('cmd', ['/c', 'start', '', url]);
  } else {
    // Linux: try xdg-open, fall back to sensible-browser
    return runCommand('xdg-open', [url]).pipe(
      Effect.catch(() => runCommand('sensible-browser', [url])),
      Effect.catch(() => Effect.void),
    );
  }
}
