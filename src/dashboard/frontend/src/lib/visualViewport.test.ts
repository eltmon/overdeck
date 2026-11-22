import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_HEIGHT_VAR, APP_OFFSET_TOP_VAR, applyVisualViewportVars, useVisualViewportVars } from './visualViewport';

class FakeVisualViewport extends EventTarget {
  height: number;
  offsetTop: number;
  scale: number;

  constructor(init: { height: number; offsetTop: number; scale: number }) {
    super();
    this.height = init.height;
    this.offsetTop = init.offsetTop;
    this.scale = init.scale;
  }
}

function TestComponent() {
  useVisualViewportVars();
  return null;
}

describe('applyVisualViewportVars', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
    document.documentElement.style.removeProperty(APP_OFFSET_TOP_VAR);
  });

  it('sets --app-height and --app-offset-top from the visual viewport', () => {
    const root = document.createElement('div');
    applyVisualViewportVars(root, { height: 400.7, offsetTop: 120.5, scale: 1 });

    expect(root.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('400px');
    expect(root.style.getPropertyValue(APP_OFFSET_TOP_VAR)).toBe('120px');
  });

  it('removes both variables while pinch-zoomed', () => {
    const root = document.createElement('div');
    root.style.setProperty(APP_HEIGHT_VAR, '400px');
    root.style.setProperty(APP_OFFSET_TOP_VAR, '120px');

    applyVisualViewportVars(root, { height: 400.7, offsetTop: 120.5, scale: 2 });

    expect(root.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('');
    expect(root.style.getPropertyValue(APP_OFFSET_TOP_VAR)).toBe('');
  });
});

describe('useVisualViewportVars', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
    document.documentElement.style.removeProperty(APP_OFFSET_TOP_VAR);
    vi.unstubAllGlobals();
  });

  it('updates on resize and scroll and is a no-op without visualViewport', () => {
    const vv = new FakeVisualViewport({ height: 600, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', vv);

    const { unmount } = render(createElement(TestComponent));
    expect(document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('600px');

    vv.height = 300;
    vv.offsetTop = 40;
    vv.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('300px');
    expect(document.documentElement.style.getPropertyValue(APP_OFFSET_TOP_VAR)).toBe('40px');

    vv.height = 250;
    vv.dispatchEvent(new Event('scroll'));
    expect(document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('250px');
    unmount();

    document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
    document.documentElement.style.removeProperty(APP_OFFSET_TOP_VAR);
    vi.stubGlobal('visualViewport', undefined);
    expect(() => render(createElement(TestComponent))).not.toThrow();
    expect(document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('');
  });
});
