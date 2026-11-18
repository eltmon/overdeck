import { describe, expect, it } from 'vitest';

import { ComputerUseError } from '../errors.js';
import { renderErrorJson, renderErrorText, renderResultJson, renderResultText, type RawSnapshot } from '../format.js';

const SNAPSHOT: RawSnapshot = {
  snapshotId: 's1',
  app: { name: 'gnome-calculator', bundleIdentifier: 'gnome-calculator', pid: 123 },
  windowTitle: 'Calculator',
  windowIndex: 0,
  windowBounds: { x: 0, y: 0, width: 400, height: 600 },
  treeLines: ['0 window Calculator', '\t1 button 7'],
  focusedSummary: 'button 7',
  selectedText: null,
  truncation: null,
  elements: [{ index: 1, name: '7' }],
};

describe('renderResultText (PAN-5452)', () => {
  it('renders the App/Window line, tree lines, Focused and Screenshot in order (ac1)', () => {
    const text = renderResultText({ snapshot: SNAPSHOT, screenshot: { path: '/x/shot.png', width: 400, height: 600, scale: 1 } });
    expect(text.split('\n')).toEqual([
      'App: gnome-calculator (pid 123)  Window: Calculator [index 0]',
      '0 window Calculator',
      '\t1 button 7',
      'Focused: button 7',
      'Screenshot: /x/shot.png',
    ]);
  });

  it('renders "Focused: none" when there is no focused element', () => {
    const text = renderResultText({ snapshot: { ...SNAPSHOT, focusedSummary: null }, screenshot: null });
    expect(text).toContain('Focused: none');
  });

  it('renders "Screenshot: skipped" when no screenshot was saved and the helper reported no error', () => {
    const text = renderResultText({ snapshot: SNAPSHOT, screenshot: null });
    expect(text).toContain('Screenshot: skipped');
  });

  it('renders "Screenshot: failed: <message>" when the helper reported a screenshot error', () => {
    const text = renderResultText({ snapshot: { ...SNAPSHOT, screenshotError: { message: 'no capture backend' } }, screenshot: null });
    expect(text).toContain('Screenshot: failed: no capture backend');
  });

  it('adds an Action: line as the first line, with verification (ac2)', () => {
    const text = renderResultText({
      action: { path: 'synthetic', actionName: 'typeText', fallbackReason: null, verification: { state: 'unverified', reason: 'synthetic_input' } },
      snapshot: SNAPSHOT,
      screenshot: null,
    });
    expect(text.split('\n')[0]).toBe('Action: synthetic/typeText, verification: unverified (synthetic_input)');
  });

  it('renders an Action: line with no verification suffix when verification is absent', () => {
    const text = renderResultText({ action: { path: 'accessibility', actionName: 'click' }, snapshot: SNAPSHOT, screenshot: null });
    expect(text.split('\n')[0]).toBe('Action: accessibility/click');
  });

  it('appends the macOS delivery after the verification (PAN-5463)', () => {
    const text = renderResultText({
      action: { path: 'accessibility', actionName: 'AXPress', delivery: 'background', verification: { state: 'verified', reason: 'value read back' } },
      snapshot: SNAPSHOT,
      screenshot: null,
    });
    expect(text.split('\n')[0]).toBe('Action: accessibility/AXPress, verification: verified (value read back), delivery: background');
  });

  it('passes delivery through to the JSON action (PAN-5463)', () => {
    const json = renderResultJson({ action: { path: 'synthetic', actionName: null, delivery: 'foreground' }, snapshot: SNAPSHOT, screenshot: null });
    expect((json.action as Record<string, unknown>).delivery).toBe('foreground');
  });
});

describe('renderResultText note placement (PAN-5452, PRD 3e)', () => {
  it('renders the subtree note as the true last line, after Focused and Screenshot', () => {
    const text = renderResultText({ snapshot: SNAPSHOT, screenshot: null, note: 'Indexes above are for this subtree only; any action returns the whole window again.' });
    const lines = text.split('\n');
    expect(lines.at(-1)).toBe('Indexes above are for this subtree only; any action returns the whole window again.');
    expect(lines.at(-2)).toMatch(/^Screenshot:/);
  });
});

describe('renderResultJson (PAN-5452)', () => {
  it('includes screenshot.path and never screenshotPngBase64 (ac3)', () => {
    const json = renderResultJson({ snapshot: SNAPSHOT, screenshot: { path: '/x/shot.png', width: 400, height: 600, scale: 1 } });
    expect(JSON.stringify(json)).not.toContain('screenshotPngBase64');
    expect(json.screenshot).toEqual({ path: '/x/shot.png', width: 400, height: 600, scale: 1 });
    expect((json.snapshot as Record<string, unknown>).id).toBe('s1');
  });

  it('sets screenshot to null when none was saved', () => {
    const json = renderResultJson({ snapshot: SNAPSHOT, screenshot: null });
    expect(json.screenshot).toBeNull();
  });

  it('omits the screenshot field entirely for an apps/windows/capabilities-only result', () => {
    const json = renderResultJson({ apps: [{ name: 'calc', pid: 1 }] });
    expect(json).not.toHaveProperty('screenshot');
    expect(json.apps).toEqual([{ name: 'calc', pid: 1 }]);
  });
});

describe('error rendering (PAN-5452 ac4)', () => {
  it('renders text as "pan computer: <message>" and JSON as {ok:false,error:{code,message}}', () => {
    const error = new ComputerUseError('desktop_busy', 'm');
    expect(renderErrorText(error)).toBe('pan computer: m');
    expect(renderErrorJson(error)).toEqual({ ok: false, error: { code: 'desktop_busy', message: 'm' } });
  });
});
