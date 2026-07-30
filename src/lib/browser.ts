/**
 * Cross-platform browser opener.
 * Used by `npx overdeck serve` to open the dashboard URL after server starts.
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

/**
 * Reveal a local path in the platform file manager (PAN-3331). Same platform
 * branching as openBrowser, and the same argument-vector spawn — a path is
 * never interpolated into a shell string.
 */
export function openPath(path: string): Effect.Effect<void, ProcessSpawnError, ChildProcessSpawner> {
  if (process.platform === 'darwin') {
    return runCommand('open', [path]);
  } else if (process.platform === 'win32') {
    // `start ""` rather than `explorer`, which exits nonzero even on success.
    return runCommand('cmd', ['/c', 'start', '', path]);
  } else {
    return runCommand('xdg-open', [path]);
  }
}

/**
 * Run an editor command template with `{path}` substituted — e.g.
 * `cursor {path}`. The template is split on whitespace into an argument vector
 * BEFORE substitution, so a path containing spaces or shell metacharacters
 * stays one argument and nothing is interpreted by a shell.
 */
export function openInEditor(
  template: string,
  path: string,
): Effect.Effect<void, ProcessSpawnError, ChildProcessSpawner> {
  const tokens = template.trim().split(/\s+/).filter((token) => token.length > 0);
  const [command, ...rest] = tokens;
  if (!command) {
    return Effect.fail(new ProcessSpawnError({ command: template, args: [], message: 'Editor command is empty' }));
  }
  const args = rest.map((token) => token.replace('{path}', path));
  // A template with no {path} placeholder still needs the path, or the editor
  // opens nothing.
  if (!tokens.some((token) => token.includes('{path}'))) args.push(path);
  return runCommand(command.replace('{path}', path), args);
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
