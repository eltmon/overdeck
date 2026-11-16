/**
 * One function per `pan computer` subcommand except `wait` (PAN-5452, PRD 3h
 * and the 3c field table). `capabilities` and `release` live in run.ts — they
 * skip this preamble entirely. Each function validates its own arguments,
 * resolves stdin and cached elements before the lock, and calls
 * `runComputerOperation` with the exact helper field names.
 */
import { assertKeyComboAllowed as assertKeyComboAllowedReal } from './blocked-key-combos.js';
import { ComputerUseError } from './errors.js';
import type { HelperResponse } from './helper.js';
import { holderKey as holderKeyReal } from './lease.js';
import { type OperationKind, runComputerOperation as runComputerOperationReal, type RunComputerOperationResult } from './run.js';
import { type ElementRecord, elementRecord as elementRecordReal } from './snapshot-store.js';
import { filterTree } from './tree-filter.js';

export const SUBTREE_NOTE = 'Indexes above are for this subtree only; any action returns the whole window again.';

interface BaseAppOptions {
  app: string;
  windowIndex?: number;
  restoreWindow?: boolean;
  noScreenshot?: boolean;
}

export interface CommandDeps {
  runComputerOperation?: typeof runComputerOperationReal;
  elementRecord?: typeof elementRecordReal;
  holderKey?: () => string;
  readStdin?: () => Promise<string>;
  assertKeyComboAllowed?: typeof assertKeyComboAllowedReal;
}

async function readStdinReal(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8').replace(/\n$/, '');
}

function invalidArgument(message: string): never {
  throw new ComputerUseError('invalid_argument', message);
}

function baseFields(options: BaseAppOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = { app: options.app };
  if (options.windowIndex !== undefined) fields.windowIndex = options.windowIndex;
  if (options.restoreWindow) fields.restoreWindow = true;
  if (options.noScreenshot) fields.noScreenshot = true;
  return fields;
}

/** `--text`/`--value` XOR their `-stdin` twin; exactly one is required. */
async function resolveTextOrValue(
  input: { value?: string; stdin?: boolean },
  flagName: 'text' | 'value',
  deps: CommandDeps,
): Promise<string> {
  if (input.value !== undefined && input.stdin) {
    invalidArgument(`--${flagName} and --${flagName}-stdin cannot both be given`);
  }
  if (input.value === undefined && !input.stdin) {
    invalidArgument(`one of --${flagName} or --${flagName}-stdin is required`);
  }
  return input.stdin ? (deps.readStdin ?? readStdinReal)() : (input.value as string);
}

async function resolveElement(app: string, index: number, holder: string, deps: CommandDeps): Promise<ElementRecord> {
  return (deps.elementRecord ?? elementRecordReal)(holder, app, index);
}

/** `--element-index` XOR `--x`/`--y` together; exactly one form is required. */
async function applyElementOrCoords(
  fields: Record<string, unknown>,
  options: { app: string; elementIndex?: number; x?: number; y?: number },
  holder: string,
  deps: CommandDeps,
): Promise<void> {
  const hasElement = options.elementIndex !== undefined;
  const hasCoords = options.x !== undefined || options.y !== undefined;
  if (hasElement && hasCoords) invalidArgument('--element-index cannot be combined with --x/--y');
  if (hasElement) {
    fields.element = await resolveElement(options.app, options.elementIndex as number, holder, deps);
    return;
  }
  if (options.x === undefined || options.y === undefined) invalidArgument('one of --element-index or --x and --y together is required');
  fields.x = options.x;
  fields.y = options.y;
}

export async function listApps(deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'read', operation: { tool: 'list_apps' } });
}

export async function listWindows(options: { app: string }, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'read', operation: { tool: 'list_windows', app: options.app } });
}

export interface GetAppStateOptions extends BaseAppOptions {
  elementIndex?: number;
  query?: string;
  maxElements?: number;
}

/**
 * Filters treeLines for --query/--max-elements and, for a cached subtree read,
 * carries the PRD 3e note as its own field rather than folding it into
 * treeLines — format.ts renders it as the command output's true last line,
 * after Focused/Screenshot, as the PRD specifies.
 */
function applyTreeFilter(result: RunComputerOperationResult, options: GetAppStateOptions): RunComputerOperationResult {
  const snapshot = (result.response as { snapshot?: { treeLines: string[] } }).snapshot;
  if (!snapshot) return result;

  const treeLines = options.query !== undefined ? filterTree(snapshot.treeLines, options.query, options.maxElements) : snapshot.treeLines;
  const isSubtreeRead = options.elementIndex !== undefined;
  if (treeLines === snapshot.treeLines && !isSubtreeRead) return result;

  const response: HelperResponse = {
    ...result.response,
    snapshot: treeLines === snapshot.treeLines ? snapshot : { ...snapshot, treeLines },
  };
  if (isSubtreeRead) response.note = SUBTREE_NOTE;
  return { ...result, response };
}

export async function getAppState(options: GetAppStateOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  if (options.elementIndex !== undefined) {
    // get-app-state reads a cached subtree root, not an action target.
    fields.root = await resolveElement(options.app, options.elementIndex, holder, deps);
  }
  const kind: OperationKind = options.restoreWindow ? 'input' : 'read';
  const result = await (deps.runComputerOperation ?? runComputerOperationReal)({ kind, operation: { tool: 'get_app_state', ...fields } });
  return applyTreeFilter(result, options);
}

export interface ClickOptions extends BaseAppOptions {
  elementIndex?: number;
  x?: number;
  y?: number;
  mouseButton?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: string;
}

export async function click(options: ClickOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  await applyElementOrCoords(fields, options, holder, deps);
  if (options.mouseButton !== undefined) fields.mouse_button = options.mouseButton;
  if (options.clickCount !== undefined) fields.click_count = options.clickCount;
  if (options.modifiers !== undefined) fields.modifiers = options.modifiers;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'click', ...fields } });
}

export interface PerformSecondaryActionOptions extends BaseAppOptions {
  elementIndex: number;
  action: string;
}

export async function performSecondaryAction(
  options: PerformSecondaryActionOptions,
  deps: CommandDeps = {},
): Promise<RunComputerOperationResult> {
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  fields.element = await resolveElement(options.app, options.elementIndex, holder, deps);
  fields.action = options.action;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'perform_secondary_action', ...fields } });
}

export interface SetValueOptions extends BaseAppOptions {
  elementIndex: number;
  value?: string;
  valueStdin?: boolean;
}

export async function setValue(options: SetValueOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const value = await resolveTextOrValue({ value: options.value, stdin: options.valueStdin }, 'value', deps);
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  fields.element = await resolveElement(options.app, options.elementIndex, holder, deps);
  fields.value = value;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'set_value', ...fields } });
}

export interface TypeTextOptions extends BaseAppOptions {
  elementIndex?: number;
  text?: string;
  textStdin?: boolean;
}

export async function typeText(options: TypeTextOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const text = await resolveTextOrValue({ value: options.text, stdin: options.textStdin }, 'text', deps);
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  if (options.elementIndex !== undefined) {
    fields.element = await resolveElement(options.app, options.elementIndex, holder, deps);
  }
  fields.text = text;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'type_text', ...fields } });
}

export interface PressKeyOptions extends BaseAppOptions {
  key: string;
  allowSystemShortcut?: boolean;
}

export async function pressKey(options: PressKeyOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  (deps.assertKeyComboAllowed ?? assertKeyComboAllowedReal)(options.key, Boolean(options.allowSystemShortcut));
  const fields = baseFields(options);
  fields.key = options.key;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'press_key', ...fields } });
}

export interface HotkeyOptions extends BaseAppOptions {
  key: string;
  allowSystemShortcut?: boolean;
}

export async function hotkey(options: HotkeyOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  (deps.assertKeyComboAllowed ?? assertKeyComboAllowedReal)(options.key, Boolean(options.allowSystemShortcut));
  const fields = baseFields(options);
  fields.key = options.key;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'hotkey', ...fields } });
}

export interface PasteTextOptions extends BaseAppOptions {
  text?: string;
  textStdin?: boolean;
}

export async function pasteText(options: PasteTextOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const text = await resolveTextOrValue({ value: options.text, stdin: options.textStdin }, 'text', deps);
  const fields = baseFields(options);
  fields.text = text;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'paste_text', ...fields } });
}

export interface ScrollOptions extends BaseAppOptions {
  elementIndex?: number;
  x?: number;
  y?: number;
  direction: 'up' | 'down' | 'left' | 'right';
  pages?: number;
}

export async function scroll(options: ScrollOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  await applyElementOrCoords(fields, options, holder, deps);
  fields.direction = options.direction;
  if (options.pages !== undefined) fields.pages = options.pages;
  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'scroll', ...fields } });
}

export interface DragOptions extends BaseAppOptions {
  fromElementIndex?: number;
  toElementIndex?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
}

export async function drag(options: DragOptions, deps: CommandDeps = {}): Promise<RunComputerOperationResult> {
  const holder = (deps.holderKey ?? holderKeyReal)();
  const fields = baseFields(options);
  const hasElements = options.fromElementIndex !== undefined || options.toElementIndex !== undefined;
  const hasCoords =
    options.fromX !== undefined || options.fromY !== undefined || options.toX !== undefined || options.toY !== undefined;
  if (hasElements && hasCoords) invalidArgument('drag cannot combine element indexes with coordinates');

  if (hasElements) {
    if (options.fromElementIndex === undefined || options.toElementIndex === undefined) {
      invalidArgument('drag needs both --from-element-index and --to-element-index');
    }
    fields.fromElement = await resolveElement(options.app, options.fromElementIndex as number, holder, deps);
    fields.toElement = await resolveElement(options.app, options.toElementIndex as number, holder, deps);
  } else if (hasCoords) {
    if (options.fromX === undefined || options.fromY === undefined || options.toX === undefined || options.toY === undefined) {
      invalidArgument('drag needs --from-x, --from-y, --to-x and --to-y together');
    }
    fields.from_x = options.fromX;
    fields.from_y = options.fromY;
    fields.to_x = options.toX;
    fields.to_y = options.toY;
  } else {
    invalidArgument('drag needs either element indexes or coordinates');
  }

  return (deps.runComputerOperation ?? runComputerOperationReal)({ kind: 'input', operation: { tool: 'drag', ...fields } });
}
