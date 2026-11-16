/**
 * Renders `pan computer` results as text and as a stable JSON shape
 * (PAN-5452, PRD 3i). Pure functions — the CLI layer chooses stdout/stderr
 * and the exit code.
 */
import type { ComputerUseError } from './errors.js';
import type { SavedScreenshot } from './snapshot-store.js';

export interface SnapshotApp {
  name: string;
  bundleIdentifier?: string;
  pid: number | null;
}

export interface SnapshotBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The helper's `make_snapshot` output, as stored by run.ts (see the glossary). */
export interface RawSnapshot {
  snapshotId: string;
  app: SnapshotApp;
  windowTitle: string | null;
  windowIndex: number | null;
  windowBounds: SnapshotBounds | null;
  treeLines: string[];
  focusedSummary: string | null;
  selectedText: string | null;
  truncation: unknown;
  elements: readonly unknown[];
  screenshotError?: { message: string } | null;
}

export interface ActionVerification {
  state: string;
  reason: string;
}

export interface HelperAction {
  path: string;
  actionName: string | null;
  fallbackReason?: string | null;
  verification?: ActionVerification | null;
}

export interface RenderInput {
  action?: HelperAction;
  snapshot?: RawSnapshot;
  /** Present (possibly null) whenever a snapshot was captured; omitted for apps/windows/capabilities-only results. */
  screenshot?: SavedScreenshot | null;
  apps?: readonly { name: string; pid: number | null }[];
  windows?: readonly { index: number; title: string | null; isMinimized?: boolean }[];
  capabilities?: unknown;
  matches?: readonly string[];
  /** PRD 3e: the subtree-read caveat. Always the true last line of text output. */
  note?: string;
}

function screenshotLine(snapshot: RawSnapshot, screenshot: SavedScreenshot | null | undefined): string {
  if (screenshot) return screenshot.path;
  if (snapshot.screenshotError) return `failed: ${snapshot.screenshotError.message}`;
  return 'skipped';
}

function renderSnapshotLines(snapshot: RawSnapshot, screenshot: SavedScreenshot | null | undefined): string[] {
  return [
    `App: ${snapshot.app.name} (pid ${snapshot.app.pid ?? '-'})  Window: ${snapshot.windowTitle ?? '-'} [index ${snapshot.windowIndex ?? '-'}]`,
    ...snapshot.treeLines,
    `Focused: ${snapshot.focusedSummary ?? 'none'}`,
    `Screenshot: ${screenshotLine(snapshot, screenshot)}`,
  ];
}

function renderActionLine(action: HelperAction): string {
  const base = `Action: ${action.path}/${action.actionName ?? '-'}`;
  return action.verification ? `${base}, verification: ${action.verification.state} (${action.verification.reason})` : base;
}

function renderAppsLines(apps: RenderInput['apps']): string[] {
  return (apps ?? []).map((app) => `${app.name} (pid ${app.pid ?? '-'})`);
}

function renderWindowsLines(windows: RenderInput['windows']): string[] {
  return (windows ?? []).map(
    (window) => `[index ${window.index}] ${window.title ?? '-'}${window.isMinimized ? ' (minimized)' : ''}`,
  );
}

export function renderResultText(input: RenderInput): string {
  const lines: string[] = [];
  if (input.action) lines.push(renderActionLine(input.action));
  if (input.snapshot) lines.push(...renderSnapshotLines(input.snapshot, input.screenshot));
  if (input.apps) lines.push(...renderAppsLines(input.apps));
  if (input.windows) lines.push(...renderWindowsLines(input.windows));
  if (input.capabilities) lines.push(JSON.stringify(input.capabilities));
  if (input.matches) lines.push(...input.matches);
  if (input.note !== undefined) lines.push(input.note);
  return lines.join('\n');
}

export function renderResultJson(input: RenderInput): Record<string, unknown> {
  const result: Record<string, unknown> = { ok: true };
  if (input.action) result.action = input.action;
  if (input.snapshot) {
    result.snapshot = {
      id: input.snapshot.snapshotId,
      app: input.snapshot.app,
      window: { title: input.snapshot.windowTitle, index: input.snapshot.windowIndex, bounds: input.snapshot.windowBounds },
      treeText: input.snapshot.treeLines.join('\n'),
      elementCount: input.snapshot.elements.length,
      focusedSummary: input.snapshot.focusedSummary,
      selectedText: input.snapshot.selectedText,
      truncation: input.snapshot.truncation,
    };
  }
  if ('screenshot' in input) {
    result.screenshot = input.screenshot
      ? { path: input.screenshot.path, width: input.screenshot.width, height: input.screenshot.height, scale: input.screenshot.scale }
      : null;
  }
  if (input.apps !== undefined) result.apps = input.apps;
  if (input.windows !== undefined) result.windows = input.windows;
  if (input.capabilities !== undefined) result.capabilities = input.capabilities;
  if (input.matches !== undefined) result.matches = input.matches;
  if (input.note !== undefined) result.note = input.note;
  return result;
}

export function renderErrorText(error: ComputerUseError): string {
  return `pan computer: ${error.message}`;
}

export function renderErrorJson(error: ComputerUseError): { ok: false; error: { code: string; message: string } } {
  return { ok: false, error: { code: error.code, message: error.message } };
}
