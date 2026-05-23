import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import type { EditorId } from '@panctl/contracts';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';

type Editor = (typeof import('@panctl/contracts'))['EDITORS'][number];

async function loadEditors(): Promise<readonly Editor[]> {
  const { EDITORS } = await import('@panctl/contracts');
  return EDITORS;
}

function getFileManagerCommand(): string | null {
  switch (process.platform) {
    case 'linux': return 'xdg-open';
    case 'darwin': return 'open';
    case 'win32': return 'explorer';
    default: return null;
  }
}

function isCommandAvailable(command: string): boolean {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${which} ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function detectFirstAvailableEditor(editors: readonly Editor[]): { id: EditorId; command: string } | null {
  for (const editor of editors) {
    if (editor.id === 'file-manager') continue;
    if (editor.command && isCommandAvailable(editor.command)) {
      return { id: editor.id, command: editor.command };
    }
  }
  return null;
}

export async function openCommand(issueId: string, options: { editor?: string }) {
  const editors = await loadEditors();
  const issueLower = issueId.toLowerCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    console.error(`No project found for issue ${issueId}`);
    process.exit(1);
  }

  const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueLower}`);
  if (!existsSync(workspacePath)) {
    console.error(`Workspace not found: ${workspacePath}`);
    process.exit(1);
  }

  let editorCommand: string;
  let editorLabel: string;

  if (options.editor) {
    const entry = editors.find((e) => e.id === options.editor);
    if (!entry) {
      console.error(`Unknown editor: ${options.editor}`);
      console.error(`Available: ${editors.map((e) => e.id).join(', ')}`);
      process.exit(1);
    }
    if (entry.id === 'file-manager') {
      const cmd = getFileManagerCommand();
      if (!cmd) {
        console.error('File manager not available on this platform');
        process.exit(1);
      }
      editorCommand = cmd;
      editorLabel = 'File Manager';
    } else {
      editorCommand = entry.command!;
      editorLabel = entry.label;
    }
  } else {
    const detected = detectFirstAvailableEditor(editors);
    if (!detected) {
      console.error('No supported editor found in PATH');
      console.error(`Supported: ${editors.filter((e) => e.command).map((e) => `${e.label} (${e.command})`).join(', ')}`);
      process.exit(1);
    }
    editorCommand = detected.command;
    editorLabel = editors.find((e) => e.id === detected.id)!.label;
  }

  console.log(`Opening ${workspacePath} in ${editorLabel}...`);

  const child = spawn(editorCommand, [workspacePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
