/**
 * `pan open <target>` (PAN-5349 O-D1): open a file, folder or issue workspace
 * in the Overdeck dashboard, or with `--editor [name]` in an external editor.
 *
 * The dashboard resolves the path (`POST /api/ui/open`) and tells the leader
 * tab to open it. When no tab is listening, or with `--new-tab`, the CLI opens
 * the `/open?path=…` link in the browser instead.
 */
import { exitCli } from '../exit.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { EditorId } from '@overdeck/contracts';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { callDashboard, isDashboardUnreachable } from './dashboard-call.js';
import { parseOpenTarget } from './open-target.js';

type Editor = (typeof import('@overdeck/contracts'))['EDITORS'][number];

async function loadEditors(): Promise<readonly Editor[]> {
  const { EDITORS } = await import('@overdeck/contracts');
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

/** Open `targetPath` in `editor`, or the first editor on PATH when `editor` is true. */
export async function openInEditor(targetPath: string, editor: string | true): Promise<void> {
  const editors = await loadEditors();
  let editorCommand: string;
  let editorLabel: string;

  if (editor !== true) {
    const entry = editors.find((e) => e.id === editor);
    if (!entry) {
      console.error(`Unknown editor: ${editor}`);
      console.error(`Available: ${editors.map((e) => e.id).join(', ')}`);
      return exitCli(1);
    }
    if (entry.id === 'file-manager') {
      const cmd = getFileManagerCommand();
      if (!cmd) {
        console.error('File manager not available on this platform');
        return exitCli(1);
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
      return exitCli(1);
    }
    editorCommand = detected.command;
    editorLabel = editors.find((e) => e.id === detected.id)!.label;
  }

  console.log(`Opening ${targetPath} in ${editorLabel}...`);

  const child = spawn(editorCommand, [targetPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export interface OpenOptions {
  editor?: string | true;
  line?: string;
  column?: string;
  newTab?: boolean;
}

export interface OpenDeps {
  callDashboard: typeof callDashboard;
  openBrowser: (url: string) => Promise<void>;
  openInEditor: (targetPath: string, editor: string | true) => Promise<void>;
  dashboardUrl: () => Promise<string>;
  cwd: () => string;
  home: () => string;
  log: (line: string) => void;
  error: (line: string) => void;
  exit: (code: number) => Promise<never>;
}

async function openUrlInBrowser(url: string): Promise<void> {
  const [{ Effect }, { openBrowser }, { layer: nodeServicesLayer }] = await Promise.all([
    import('effect'),
    import('../../lib/browser.js'),
    import('@effect/platform-node/NodeServices'),
  ]);
  await Effect.runPromise(openBrowser(url).pipe(Effect.provide(nodeServicesLayer)));
}

const defaultDeps: OpenDeps = {
  callDashboard,
  openBrowser: openUrlInBrowser,
  openInEditor,
  dashboardUrl: async () => (await import('../../lib/config.js')).getDashboardApiUrl(),
  cwd: () => process.cwd(),
  home: () => homedir(),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
  exit: (code) => exitCli(code),
};

function parsePosition(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** The `/open` link for `abs` on the dashboard at `base`. */
export function openLinkUrl(base: string, abs: string, line?: number, column?: number): string {
  const params = new URLSearchParams({ path: abs });
  if (line !== undefined) params.set('line', String(line));
  if (column !== undefined) params.set('column', String(column));
  return `${base.replace(/\/+$/, '')}/open?${params.toString()}`;
}

/** Ask the dashboard to open `abs`; fall back to the `/open` link when no tab is listening. */
export async function openInDashboard(
  abs: string,
  position: { line?: number; column?: number; newTab?: boolean },
  deps: OpenDeps = defaultDeps,
): Promise<void> {
  const { line, column, newTab = false } = position;
  let response: Response;
  try {
    response = await deps.callDashboard('/api/ui/open', { method: 'POST', body: { path: abs, line, column, dryRun: newTab } });
  } catch (error) {
    if (isDashboardUnreachable(error)) {
      deps.error("Overdeck isn't running. Start it with: pan up");
      return deps.exit(1);
    }
    throw error;
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    if (body['error'] === 'outside-projects') {
      deps.error(`${abs} isn't in a registered project. Add it with: ${String(body['suggestion'])}`);
    } else if (body['error'] === 'no-root') {
      deps.error(`${abs} is inside ${String(body['projectKey'])} but not in a feature or scratch workspace`);
    } else if (body['error'] === 'not-found') {
      deps.error(`Not found: ${abs}`);
    } else {
      deps.error(`Could not open ${abs}: ${typeof body['error'] === 'string' ? body['error'] : `HTTP ${response.status}`}`);
    }
    return deps.exit(1);
  }
  if (newTab || body['delivered'] === 0) {
    const url = openLinkUrl(await deps.dashboardUrl(), abs, line, column);
    deps.log(`Opening ${url} in your browser`);
    await deps.openBrowser(url);
    return;
  }
  const relPath = typeof body['relPath'] === 'string' && body['relPath'] ? body['relPath'] : 'root folder';
  deps.log(`Opened ${relPath} in ${String(body['projectKey'])}`);
}

/** The issue's feature workspace path, or null after printing why. */
function issueWorkspacePath(issueId: string, deps: OpenDeps): string | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    deps.error(`No project found for issue ${issueId}`);
    return null;
  }
  const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  if (!existsSync(workspacePath)) {
    deps.error(`Workspace not found: ${workspacePath}`);
    return null;
  }
  return workspacePath;
}

export async function runOpen(target: string, options: OpenOptions, deps: OpenDeps = defaultDeps): Promise<void> {
  const line = parsePosition(options.line);
  const column = parsePosition(options.column);
  if (line === null || column === null) {
    deps.error('--line and --column take a positive whole number');
    return deps.exit(1);
  }
  const parsed = parseOpenTarget(target, deps.cwd(), deps.home());
  if (parsed.kind === 'invalid') {
    deps.error(`Not a file, folder or issue: ${target}`);
    return deps.exit(1);
  }
  let abs: string;
  if (parsed.kind === 'issue') {
    const workspacePath = issueWorkspacePath(parsed.id, deps);
    if (!workspacePath) return deps.exit(1);
    abs = workspacePath;
  } else {
    abs = parsed.abs;
  }
  if (options.editor !== undefined) {
    await deps.openInEditor(abs, options.editor);
    return;
  }
  const position = parsed.kind === 'path' ? { line: line ?? parsed.line, column: column ?? parsed.column } : { line, column };
  await openInDashboard(abs, { ...position, newTab: options.newTab === true }, deps);
}

export async function openCommand(target: string, options: OpenOptions): Promise<void> {
  await runOpen(target, options);
}
