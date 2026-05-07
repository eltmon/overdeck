import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { Effect, Layer, Context } from 'effect';
import { EDITORS, type EditorId, type OpenInEditorInput } from '@panctl/contracts';
import { PanRpcError } from '@panctl/contracts';

const execAsync = promisify(exec);

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
        Effect.try({
          try: () => {
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
    });
  }),
);
