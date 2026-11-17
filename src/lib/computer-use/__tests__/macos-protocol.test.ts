import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isComputerUseError } from '../errors.js';
import { renderResultText, type HelperAction, type RawSnapshot } from '../format.js';
import { fromMacResponse, toMacRequest } from '../macos-protocol.js';

const GET_APP_STATE = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'macos-get-app-state.json'), 'utf8'),
) as Record<string, unknown>;

const element = (index: number) => ({ index, role: 'button' });

describe('toMacRequest (PAN-5463 ac1)', () => {
  it.each([
    [{ tool: 'handshake' }, 'handshake', {}],
    [{ tool: 'list_apps' }, 'listApps', {}],
    [{ tool: 'list_windows', app: 'TextEdit' }, 'listWindows', { app: 'TextEdit' }],
    [
      { tool: 'get_app_state', app: 'TextEdit', windowIndex: 1, noScreenshot: true, root: element(4) },
      'getAppState',
      { app: 'TextEdit', windowIndex: 1, noScreenshot: true, rootElementIndex: 4 },
    ],
    [
      { tool: 'click', app: 'TextEdit', element: element(7), mouse_button: 'right', click_count: 2, modifiers: ['cmd'] },
      'click',
      { app: 'TextEdit', elementIndex: 7, mouseButton: 'right', clickCount: 2, modifiers: ['cmd'] },
    ],
    [{ tool: 'click', app: 'TextEdit', x: 10, y: 20 }, 'click', { app: 'TextEdit', x: 10, y: 20 }],
    [
      { tool: 'perform_secondary_action', app: 'TextEdit', element: element(1), action: 'AXShowMenu' },
      'performSecondaryAction',
      { app: 'TextEdit', elementIndex: 1, action: 'AXShowMenu' },
    ],
    [{ tool: 'set_value', app: 'TextEdit', element: element(4), value: 'hi' }, 'setValue', { app: 'TextEdit', elementIndex: 4, value: 'hi' }],
    [
      { tool: 'type_text', app: 'TextEdit', element: element(4), text: 'abc', restoreWindow: true },
      'typeText',
      { app: 'TextEdit', elementIndex: 4, text: 'abc', restoreWindow: true },
    ],
    [{ tool: 'press_key', app: 'TextEdit', key: 'return' }, 'pressKey', { app: 'TextEdit', key: 'return' }],
    [{ tool: 'hotkey', app: 'TextEdit', key: 'cmd+a' }, 'hotkey', { app: 'TextEdit', key: 'cmd+a' }],
    [{ tool: 'paste_text', app: 'TextEdit', text: 'pasted' }, 'pasteText', { app: 'TextEdit', text: 'pasted' }],
    [
      { tool: 'scroll', app: 'TextEdit', element: element(1), direction: 'down', pages: 2 },
      'scroll',
      { app: 'TextEdit', elementIndex: 1, direction: 'down', pages: 2 },
    ],
    [
      { tool: 'drag', app: 'TextEdit', fromElement: element(1), toElement: element(7) },
      'drag',
      { app: 'TextEdit', fromElementIndex: 1, toElementIndex: 7 },
    ],
    [
      { tool: 'drag', app: 'TextEdit', from_x: 1, from_y: 2, to_x: 3, to_y: 4 },
      'drag',
      { app: 'TextEdit', fromX: 1, fromY: 2, toX: 3, toY: 4 },
    ],
  ])('maps %o to %s', (operation, method, params) => {
    expect(toMacRequest(operation, 'holder-1')).toEqual({ method, params: { ...params, session: 'holder-1' } });
  });

  it('throws invalid_argument for an unknown tool', () => {
    let caught: unknown;
    try {
      toMacRequest({ tool: 'teleport' }, 'h');
    } catch (error) {
      caught = error;
    }
    expect(isComputerUseError(caught) && caught.code).toBe('invalid_argument');
  });
});

describe('fromMacResponse', () => {
  const request = toMacRequest({ tool: 'get_app_state', app: 'TextEdit', windowIndex: 2 }, 'holder-1');

  it('keeps only the element lines, parses non-contiguous indexes and reads the focus footer (ac2)', () => {
    const response = fromMacResponse('getAppState', GET_APP_STATE, request);
    const snapshot = response.snapshot as RawSnapshot & Record<string, unknown>;

    expect(response.ok).toBe(true);
    expect(snapshot.treeLines).toEqual([
      '0 standard window Untitled',
      '\t1 scroll area',
      '\t\t4 text field Untitled',
      '\t\t... 3 more not shown (snapshot limit)',
      '\t7 button (disabled) Close',
    ]);
    expect(snapshot.elements).toEqual([{ index: 0 }, { index: 1 }, { index: 4 }, { index: 7 }]);
    expect(snapshot.focusedSummary).toBe('4 text field');
  });

  it('maps the snapshot header fields and screenshot', () => {
    const snapshot = fromMacResponse('getAppState', GET_APP_STATE, request).snapshot as RawSnapshot & Record<string, unknown>;

    expect(snapshot).toMatchObject({
      snapshotId: 'snap-42',
      app: { name: 'TextEdit', bundleIdentifier: 'com.apple.TextEdit', pid: 4242 },
      windowTitle: 'Untitled',
      windowIndex: 2,
      windowBounds: { x: 100, y: 80, width: 800, height: 600 },
      selectedText: null,
      truncation: { truncated: true, maxNodes: 1200, maxDepth: 40, maxDepthReached: false },
      screenshotPngBase64: 'iVBORw0KGgo=',
      screenshotWidth: 1600,
      screenshotHeight: 1200,
      screenshotScale: 2,
      screenshotError: null,
    });
  });

  it('returns null screenshot fields and the helper message when the screenshot failed (ac4)', () => {
    const failed = { ...GET_APP_STATE, screenshot: null, screenshotStatus: { state: 'failed', code: 'screenshot_failed', message: 'Screen Recording is off' } };
    const snapshot = fromMacResponse('getAppState', failed, request).snapshot as RawSnapshot & Record<string, unknown>;

    expect(snapshot.screenshotPngBase64).toBeNull();
    expect(snapshot.screenshotWidth).toBeNull();
    expect(snapshot.screenshotError).toEqual({ message: 'Screen Recording is off' });
  });

  it('reads "No UI element is currently focused." as no focus and an empty title as null', () => {
    const snapshot = asSnapshot({
      ...GET_APP_STATE,
      snapshot: {
        ...(GET_APP_STATE.snapshot as Record<string, unknown>),
        window: { title: '', x: 0, y: 0, width: 1, height: 1 },
        treeText: 'App=x (pid 1)\nWindow: "", App: x.\n\n0 window\n\nNo UI element is currently focused.',
      },
    });
    expect(snapshot.focusedSummary).toBeNull();
    expect(snapshot.windowTitle).toBeNull();
    expect(snapshot.elements).toEqual([{ index: 0 }]);
  });

  it('maps a verified action with delivery and renders it (ac3)', () => {
    const clickRequest = toMacRequest({ tool: 'set_value', app: 'TextEdit', element: element(4), value: 'x' }, 'h');
    const result = {
      ...GET_APP_STATE,
      action: { path: 'accessibility', actionName: 'AXValue', fallbackReason: null, delivery: 'background', verification: { state: 'verified', property: 'value' }, targetWindowId: 77 },
    };

    const response = fromMacResponse('setValue', result, clickRequest);
    const action = response.action as HelperAction;

    expect(action).toEqual({
      path: 'accessibility',
      actionName: 'AXValue',
      fallbackReason: null,
      delivery: 'background',
      verification: { state: 'verified', reason: 'value read back' },
    });
    expect((response.snapshot as RawSnapshot).snapshotId).toBe('snap-42');
    expect(renderResultText({ action, snapshot: response.snapshot as RawSnapshot, screenshot: null }).split('\n')[0]).toBe(
      'Action: accessibility/AXValue, verification: verified (value read back), delivery: background',
    );
  });

  it('keeps an unverified reason and maps a missing verification to null', () => {
    const unverified = fromMacResponse('typeText', { ...GET_APP_STATE, action: { path: 'synthetic', verification: { state: 'unverified', reason: 'synthetic_input' } } }, request);
    expect((unverified.action as HelperAction).verification).toEqual({ state: 'unverified', reason: 'synthetic_input' });
    const none = fromMacResponse('click', { ...GET_APP_STATE, action: { path: 'accessibility', actionName: 'AXPress' } }, request);
    expect((none.action as HelperAction).verification).toBeNull();
  });

  it('maps handshake, listApps and listWindows', () => {
    expect(fromMacResponse('handshake', { platform: 'darwin', provider: 'p' }, request)).toEqual({ ok: true, capabilities: { platform: 'darwin', provider: 'p' } });
    expect(fromMacResponse('listApps', { apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 1, isRunning: true }, { name: 'X', bundleId: null, pid: 2 }] }, request)).toEqual({
      ok: true,
      apps: [
        { name: 'Finder', bundleIdentifier: 'com.apple.finder', pid: 1 },
        { name: 'X', bundleIdentifier: undefined, pid: 2 },
      ],
    });
    const windows = [{ index: 0, title: 'Untitled', isMinimized: false }];
    expect(fromMacResponse('listWindows', { app: { name: 'TextEdit' }, windows }, request)).toEqual({ ok: true, app: { name: 'TextEdit' }, windows });
  });

  function asSnapshot(result: Record<string, unknown>): RawSnapshot {
    return fromMacResponse('getAppState', result, request).snapshot as RawSnapshot;
  }
});
