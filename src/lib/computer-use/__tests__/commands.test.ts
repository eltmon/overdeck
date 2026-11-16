import { describe, expect, it, vi } from 'vitest';

import {
  click,
  drag,
  getAppState,
  hotkey,
  pasteText,
  performSecondaryAction,
  pressKey,
  scroll,
  setValue,
  SUBTREE_NOTE,
  typeText,
  type CommandDeps,
} from '../commands.js';
import { isComputerUseError } from '../errors.js';

interface CapturedCall {
  kind: string;
  operation: Record<string, unknown>;
}

function captureRunComputerOperation(response: Record<string, unknown> = { ok: true }) {
  const calls: CapturedCall[] = [];
  const runComputerOperation = vi.fn(async (input: CapturedCall) => {
    calls.push(input);
    return { response, screenshot: null };
  });
  return { runComputerOperation, calls };
}

describe('click (PAN-5452 ac1)', () => {
  it('resolves the cached element record and sends kind input', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    const elementRecord = vi.fn().mockResolvedValue({ index: 3, name: 'seven' });
    const deps: CommandDeps = { runComputerOperation, elementRecord, holderKey: () => 'holder-a' };

    await click({ app: 'calc', elementIndex: 3 }, deps);

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('input');
    expect(calls[0].operation.element).toEqual({ index: 3, name: 'seven' });
    expect(calls[0].operation.tool).toBe('click');
    expect(elementRecord).toHaveBeenCalledWith('holder-a', 'calc', 3);
  });

  it('sends x/y when coordinates are given instead of an element', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    await click({ app: 'calc', x: 10, y: 20 }, { runComputerOperation });
    expect(calls[0].operation).toMatchObject({ x: 10, y: 20 });
  });

  it('throws invalid_argument when neither an element nor coordinates are given', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await click({ app: 'calc' }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
    expect(runComputerOperation).not.toHaveBeenCalled();
  });

  it('throws invalid_argument when both an element and coordinates are given', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await click({ app: 'calc', elementIndex: 1, x: 1, y: 1 }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
  });
});

describe('drag (PAN-5452 ac2)', () => {
  it('sends from_x/from_y/to_x/to_y for coordinates', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    await drag({ app: 'calc', fromX: 1, fromY: 2, toX: 3, toY: 4 }, { runComputerOperation });
    expect(calls[0].operation).toMatchObject({ from_x: 1, from_y: 2, to_x: 3, to_y: 4 });
  });

  it('sends fromElement/toElement records for element indexes', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    const elementRecord = vi.fn().mockImplementation(async (_holder: string, _app: string, index: number) => ({ index }));
    await drag({ app: 'calc', fromElementIndex: 1, toElementIndex: 2 }, { runComputerOperation, elementRecord });
    expect(calls[0].operation.fromElement).toEqual({ index: 1 });
    expect(calls[0].operation.toElement).toEqual({ index: 2 });
  });

  it('throws invalid_argument when neither form is complete', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await drag({ app: 'calc', fromX: 1 }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
  });
});

describe('type-text / set-value / paste-text stdin (PAN-5452 ac3)', () => {
  it('type-text --text-stdin reads stdin for the text field', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    const readStdin = vi.fn().mockResolvedValue('hunter2');
    await typeText({ app: 'calc', textStdin: true }, { runComputerOperation, readStdin });
    expect(readStdin).toHaveBeenCalled();
    expect(calls[0].operation.text).toBe('hunter2');
  });

  it('type-text throws invalid_argument when both --text and --text-stdin are given', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await typeText({ app: 'calc', text: 'x', textStdin: true }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
  });

  it('type-text throws invalid_argument when neither --text nor --text-stdin is given', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await typeText({ app: 'calc' }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
  });

  it('set-value --value-stdin reads stdin for the value field', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    const readStdin = vi.fn().mockResolvedValue('secret');
    const elementRecord = vi.fn().mockResolvedValue({ index: 1 });
    await setValue({ app: 'calc', elementIndex: 1, valueStdin: true }, { runComputerOperation, readStdin, elementRecord });
    expect(calls[0].operation.value).toBe('secret');
  });

  it('paste-text --text uses the given text directly', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    await pasteText({ app: 'calc', text: 'hello' }, { runComputerOperation });
    expect(calls[0].operation.text).toBe('hello');
  });
});

describe('hotkey / press-key (PAN-5452 ac4)', () => {
  it('hotkey without --allow-system-shortcut throws before calling runComputerOperation', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await hotkey({ app: 'calc', key: 'alt+F4' }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('system_shortcut_blocked');
    expect(runComputerOperation).not.toHaveBeenCalled();
  });

  it('hotkey with --allow-system-shortcut runs the operation', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    await hotkey({ app: 'calc', key: 'alt+F4', allowSystemShortcut: true }, { runComputerOperation });
    expect(calls[0].operation).toMatchObject({ tool: 'hotkey', key: 'alt+F4' });
  });

  it('press-key blocks the same chord as hotkey', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await pressKey({ app: 'calc', key: 'ctrl+q' }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('system_shortcut_blocked');
  });
});

describe('get-app-state (PAN-5452 ac5)', () => {
  it('uses kind read without --restore-window and kind input with it', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation({ ok: true, snapshot: { treeLines: ['0 window x'] } });
    await getAppState({ app: 'calc' }, { runComputerOperation });
    await getAppState({ app: 'calc', restoreWindow: true }, { runComputerOperation });
    expect(calls[0].kind).toBe('read');
    expect(calls[1].kind).toBe('input');
  });

  it('sends root (not element) for a cached subtree read', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation({ ok: true, snapshot: { treeLines: ['0 x'] } });
    const elementRecord = vi.fn().mockResolvedValue({ index: 2 });
    await getAppState({ app: 'calc', elementIndex: 2 }, { runComputerOperation, elementRecord });
    expect(calls[0].operation.root).toEqual({ index: 2 });
    expect(calls[0].operation.element).toBeUndefined();
  });

  it('filters treeLines by --query', async () => {
    const treeLines = ['0 window app', '\t1 button seven', '\t2 button eight'];
    const { runComputerOperation } = captureRunComputerOperation({ ok: true, snapshot: { treeLines } });
    const result = await getAppState({ app: 'calc', query: 'seven' }, { runComputerOperation });
    const filtered = (result.response as { snapshot: { treeLines: string[] } }).snapshot.treeLines;
    expect(filtered).toEqual(['0 window app', '\t1 button seven']);
  });

  it('appends the subtree note after a cached subtree read', async () => {
    const { runComputerOperation } = captureRunComputerOperation({ ok: true, snapshot: { treeLines: ['0 x'] } });
    const elementRecord = vi.fn().mockResolvedValue({ index: 2 });
    const result = await getAppState({ app: 'calc', elementIndex: 2 }, { runComputerOperation, elementRecord });
    const filtered = (result.response as { snapshot: { treeLines: string[] } }).snapshot.treeLines;
    expect(filtered.at(-1)).toBe(SUBTREE_NOTE);
  });
});

describe('scroll / performSecondaryAction (misc coverage)', () => {
  it('scroll requires an element or coordinates', async () => {
    const { runComputerOperation } = captureRunComputerOperation();
    const error = await scroll({ app: 'calc', direction: 'down' }, { runComputerOperation }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('invalid_argument');
  });

  it('performSecondaryAction resolves the element and sends the action name', async () => {
    const { runComputerOperation, calls } = captureRunComputerOperation();
    const elementRecord = vi.fn().mockResolvedValue({ index: 1 });
    await performSecondaryAction({ app: 'calc', elementIndex: 1, action: 'expand' }, { runComputerOperation, elementRecord });
    expect(calls[0].operation).toMatchObject({ tool: 'perform_secondary_action', action: 'expand', element: { index: 1 } });
  });
});
