import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import { EDITORS, type EditorId } from '@panctl/contracts';
import { resolveProjectFromIssue } from '../../lib/projects.js';

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

function detectFirstAvailableEditor(): { id: EditorId; command: string } | null {
  for (const editor of EDITORS) {
    if (editor.id === 'file-manager') continue;
    if (editor.command && isCommandAvailable(editor.command)) {
      return { id: editor.id, command: editor.command };
    }
  }
  return null;
}

export async function openCommand(issueId: string, options: { editor?: string }) {
  const issueLower = issueId.toLowerCase();
  const resolved = resolveProjectFromIssue(issueId);
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
    const entry = EDITORS.find((e) => e.id === options.editor);
    if (!entry) {
      console.error(`Unknown editor: ${options.editor}`);
      console.error(`Available: ${EDITORS.map((e) => e.id).join(', ')}`);
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
    const detected = detectFirstAvailableEditor();
    if (!detected) {
      console.error('No supported editor found in PATH');
      console.error(`Supported: ${EDITORS.filter((e) => e.command).map((e) => `${e.label} (${e.command})`).join(', ')}`);
      process.exit(1);
    }
    editorCommand = detected.command;
    editorLabel = EDITORS.find((e) => e.id === detected.id)!.label;
  }

  console.log(`Opening ${workspacePath} in ${editorLabel}...`);

  const child = spawn(editorCommand, [workspacePath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}
