/**
 * Maps `pan computer` operations to the macOS helper's protocol and back
 * (PAN-5463, PRD WI-3 mapping table, D-7, D-15).
 *
 * commands.ts builds Linux-shape operations (`tool: 'get_app_state'`,
 * snake_case fields, element records). The macOS helper speaks camelCase
 * methods with element indexes. `toMacRequest` converts the operation;
 * `fromMacResponse` turns the helper's result into the Linux-shape
 * `HelperResponse` that run.ts and format.ts already read.
 *
 * Pure functions: no I/O.
 */
import { ComputerUseError } from './errors.js';
import type { HelperAction, RawSnapshot } from './format.js';
import type { HelperResponse } from './helper.js';

export interface MacRequest {
  method: string;
  params: Record<string, unknown>;
}

const METHOD_BY_TOOL: Readonly<Record<string, string>> = {
  handshake: 'handshake',
  list_apps: 'listApps',
  list_windows: 'listWindows',
  get_app_state: 'getAppState',
  click: 'click',
  perform_secondary_action: 'performSecondaryAction',
  set_value: 'setValue',
  type_text: 'typeText',
  press_key: 'pressKey',
  hotkey: 'hotkey',
  paste_text: 'pasteText',
  scroll: 'scroll',
  drag: 'drag',
};

/** Element records the CLI resolved from its snapshot cache become their index. */
const ELEMENT_FIELDS: Readonly<Record<string, string>> = {
  element: 'elementIndex',
  root: 'rootElementIndex',
  fromElement: 'fromElementIndex',
  toElement: 'toElementIndex',
};

const RENAMED_FIELDS: Readonly<Record<string, string>> = {
  mouse_button: 'mouseButton',
  click_count: 'clickCount',
  from_x: 'fromX',
  from_y: 'fromY',
  to_x: 'toX',
  to_y: 'toY',
};

function elementIndexOf(field: string, value: unknown): number {
  const index = (value as { index?: unknown } | null)?.index;
  if (typeof index !== 'number' || !Number.isInteger(index)) {
    throw new ComputerUseError('invalid_argument', `pan computer: ${field} has no element index`);
  }
  return index;
}

/** The macOS request for a Linux-shape operation. `holderKey` namespaces the helper's index cache (D-15). */
export function toMacRequest(operation: Record<string, unknown>, holderKey: string): MacRequest {
  const tool = operation.tool;
  const method = typeof tool === 'string' ? METHOD_BY_TOOL[tool] : undefined;
  if (!method) {
    throw new ComputerUseError('invalid_argument', `pan computer: unknown helper tool ${JSON.stringify(tool)}`);
  }
  const params: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(operation)) {
    if (field === 'tool') continue;
    if (field in ELEMENT_FIELDS) {
      params[ELEMENT_FIELDS[field]] = elementIndexOf(field, value);
    } else {
      params[RENAMED_FIELDS[field] ?? field] = value;
    }
  }
  params.session = holderKey;
  return { method, params };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

const ELEMENT_LINE = /^\t*(\d+)(?:\s|$)/;
const FOCUSED_LINE = /^The focused UI element is (.*)\.$/;

/**
 * Splits the helper's treeText (header, blank, element lines, blank, focus
 * footer) into the element lines and the focused-element summary.
 */
function splitTreeText(treeText: string): { treeLines: string[]; focusedSummary: string | null } {
  const lines = treeText.split('\n');
  const firstBlank = lines.indexOf('');
  const lastBlank = lines.lastIndexOf('');
  const treeLines = firstBlank !== -1 && lastBlank > firstBlank ? lines.slice(firstBlank + 1, lastBlank) : [];
  const footer = lastBlank !== -1 ? (lines[lastBlank + 1] ?? '') : '';
  const focused = FOCUSED_LINE.exec(footer);
  return { treeLines, focusedSummary: focused ? focused[1] : null };
}

/** The Linux-shape snapshot (plus screenshot fields) for a macOS getAppState or action result. */
export function toRawSnapshot(result: JsonObject, request: MacRequest): RawSnapshot & JsonObject {
  const snapshot = asObject(result.snapshot);
  const app = asObject(snapshot.app);
  const window = asObject(snapshot.window);
  const screenshot = result.screenshot === null || result.screenshot === undefined ? null : asObject(result.screenshot);
  const screenshotStatus = asObject(result.screenshotStatus);
  const { treeLines, focusedSummary } = splitTreeText(typeof snapshot.treeText === 'string' ? snapshot.treeText : '');
  const elements = treeLines.flatMap((line) => {
    const match = ELEMENT_LINE.exec(line);
    return match ? [{ index: Number(match[1]) }] : [];
  });
  const title = typeof window.title === 'string' && window.title.length > 0 ? window.title : null;
  const windowIndex = request.params.windowIndex;
  const hasBounds = ['x', 'y', 'width', 'height'].every((key) => typeof window[key] === 'number');

  return {
    snapshotId: String(snapshot.id ?? ''),
    app: {
      name: typeof app.name === 'string' ? app.name : '',
      bundleIdentifier: typeof app.bundleId === 'string' ? app.bundleId : undefined,
      pid: asNumberOrNull(app.pid),
    },
    windowTitle: title,
    windowIndex: typeof windowIndex === 'number' ? windowIndex : null,
    windowBounds: hasBounds
      ? { x: window.x as number, y: window.y as number, width: window.width as number, height: window.height as number }
      : null,
    treeLines,
    focusedSummary,
    selectedText: null,
    truncation: snapshot.truncation ?? null,
    elements,
    screenshotPngBase64: screenshot && typeof screenshot.data === 'string' ? screenshot.data : null,
    screenshotWidth: screenshot ? asNumberOrNull(screenshot.width) : null,
    screenshotHeight: screenshot ? asNumberOrNull(screenshot.height) : null,
    screenshotScale: screenshot ? asNumberOrNull(screenshot.scale) : null,
    screenshotError:
      screenshotStatus.state === 'failed'
        ? { message: typeof screenshotStatus.message === 'string' ? screenshotStatus.message : 'screenshot failed' }
        : null,
  };
}

/** The Linux-shape action metadata; macOS reports `{state, property}` for verified actions. */
export function toHelperAction(action: JsonObject): HelperAction {
  const verification = action.verification === null || action.verification === undefined ? null : asObject(action.verification);
  const delivery = action.delivery === 'background' || action.delivery === 'foreground' ? action.delivery : undefined;
  return {
    path: typeof action.path === 'string' ? action.path : '',
    actionName: typeof action.actionName === 'string' ? action.actionName : null,
    fallbackReason: typeof action.fallbackReason === 'string' ? action.fallbackReason : null,
    ...(delivery ? { delivery } : {}),
    verification: verification
      ? {
          state: String(verification.state ?? ''),
          reason:
            typeof verification.reason === 'string'
              ? verification.reason
              : typeof verification.property === 'string'
                ? `${verification.property} read back`
                : 'none',
        }
      : null,
  };
}

/** The Linux-shape `HelperResponse` for a successful macOS result. */
export function fromMacResponse(method: string, result: unknown, request: MacRequest): HelperResponse {
  const body = asObject(result);
  switch (method) {
    case 'handshake':
      return { ok: true, capabilities: body };
    case 'listApps': {
      const apps = Array.isArray(body.apps) ? body.apps : [];
      return {
        ok: true,
        apps: apps.map((entry) => {
          const app = asObject(entry);
          return {
            name: typeof app.name === 'string' ? app.name : '',
            bundleIdentifier: typeof app.bundleId === 'string' ? app.bundleId : undefined,
            pid: asNumberOrNull(app.pid),
          };
        }),
      };
    }
    case 'listWindows':
      return { ok: true, app: body.app, windows: body.windows };
    case 'getAppState':
      return { ok: true, snapshot: toRawSnapshot(body, request) };
    default:
      return { ok: true, action: toHelperAction(asObject(body.action)), snapshot: toRawSnapshot(body, request) };
  }
}
