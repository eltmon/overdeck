import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { exec, execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Layer, Context } from 'effect';
import { EDITORS, type EditorId, type OpenInEditorInput } from '@overdeck/contracts';
import { PanRpcError } from '@overdeck/contracts';
import { getDefaultCwd } from '../../../lib/default-cwd.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Editor launch resolution ────────────────────────────────────────────────

interface EditorLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

function getFileManagerCommand(): string | null {
  switch (process.platform) {
    case 'linux':
      return 'xdg-open';
    case 'darwin':
      return 'open';
    case 'win32':
      return 'explorer';
    default:
      return null;
  }
}

function resolveEditorLaunch(editorId: EditorId, cwd: string): EditorLaunch | null {
  const editor = EDITORS.find((e) => e.id === editorId);
  if (!editor) return null;

  if (editor.id === 'file-manager') {
    const cmd = getFileManagerCommand();
    if (!cmd) return null;
    return { command: cmd, args: [cwd] };
  }

  return { command: editor.command!, args: [cwd] };
}

function launchDetached(launch: EditorLaunch): void {
  const child = spawn(launch.command, [...launch.args], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

// ─── Reveal in file manager ──────────────────────────────────────────────────

// Opens the folder that contains `path` with `path` selected. macOS and
// Windows have native flags for this. On Linux, the freedesktop
// FileManager1.ShowItems D-Bus call selects the item (Nautilus, Dolphin,
// Nemo, Caja and Thunar implement it); without it, open the parent folder.
async function revealInFileManager(path: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      launchDetached({ command: 'open', args: ['-R', path] });
      return;
    case 'win32':
      launchDetached({ command: 'explorer', args: [`/select,${path}`] });
      return;
    case 'linux':
      try {
        // dbus-send splits array items on commas, so escape them in the URI.
        const uri = pathToFileURL(path).href.replace(/,/g, '%2C');
        await execFileAsync('dbus-send', [
          '--session',
          '--print-reply',
          '--dest=org.freedesktop.FileManager1',
          '--type=method_call',
          '/org/freedesktop/FileManager1',
          'org.freedesktop.FileManager1.ShowItems',
          `array:string:${uri}`,
          'string:',
        ], { timeout: 10_000 });
      } catch {
        launchDetached({ command: 'xdg-open', args: [dirname(path)] });
      }
      return;
    default:
      throw new Error(`Revealing files is not supported on ${process.platform}`);
  }
}

// ─── Available editors detection (async, cached) ─────────────────────────────

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    await execAsync(`${which} ${command}`);
    return true;
  } catch {
    return false;
  }
}

async function resolveAvailableEditors(): Promise<EditorId[]> {
  const results = await Promise.all(
    EDITORS.map(async (editor) => {
      if (editor.id === 'file-manager') {
        const cmd = getFileManagerCommand();
        if (!cmd) return null;
        const available = await isCommandAvailable(cmd);
        return available ? editor.id : null;
      }
      if (!editor.command) return null;
      const available = await isCommandAvailable(editor.command);
      return available ? editor.id : null;
    }),
  );
  return results.filter((id): id is EditorId => id !== null);
}

// ─── Service interface ──────────────────────────────────────────────────────

export interface PanOpenShape {
  readonly openInEditor: (input: OpenInEditorInput) => Effect.Effect<void, PanRpcError>;
  readonly getAvailableEditors: () => Effect.Effect<EditorId[], PanRpcError>;
  readonly getDefaultCwd: () => Effect.Effect<string, PanRpcError>;
}

// ─── Service tag ─────────────────────────────────────────────────────────────

export class PanOpen extends Context.Service<PanOpen, PanOpenShape>()(
  'pan/open',
) {}

// ─── Live layer ──────────────────────────────────────────────────────────────

export const PanOpenLive = Layer.effect(
  PanOpen,
  Effect.promise(async () => {
    const cachedEditors = await resolveAvailableEditors();
    console.log(`[pan/open] Detected editors: ${cachedEditors.join(', ') || 'none'}`);

    return PanOpen.of({
      openInEditor: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (input.editor === 'file-manager' && input.reveal) {
              await revealInFileManager(input.cwd);
              return;
            }
            const launch = resolveEditorLaunch(input.editor, input.cwd);
            if (!launch) {
              throw new Error(`Editor "${input.editor}" not supported`);
            }
            launchDetached(launch);
          },
          catch: (err) =>
            new PanRpcError({
              message: `Failed to open editor: ${err instanceof Error ? err.message : String(err)}`,
              code: 'EDITOR_LAUNCH_FAILED',
            }),
        }),

      getAvailableEditors: () => Effect.succeed(cachedEditors),

      getDefaultCwd: () => Effect.sync(getDefaultCwd),
    });
  }),
);
