import '@testing-library/jest-dom';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { Terminal } from '@xterm/xterm';

const environmentFetch = globalThis.fetch;
let unexpectedRequests: string[] = [];
let guardedFetch: typeof fetch | undefined;

beforeEach(() => {
  unexpectedRequests = [];
  if (globalThis.fetch !== environmentFetch) return;

  guardedFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    unexpectedRequests.push(`${method} ${url}`);
    throw new Error(`Unexpected network request: ${method} ${url}`);
  });
  globalThis.fetch = guardedFetch;
});

afterEach(() => {
  const requests = unexpectedRequests;
  if (globalThis.fetch === guardedFetch) globalThis.fetch = environmentFetch;
  guardedFetch = undefined;
  expect(requests).toEqual([]);
});

// Install DOM API fallbacks only when the test environment does not provide them.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}

if (typeof window.prompt !== 'function') {
  window.prompt = () => null;
}

// happy-dom does not implement window.confirm.
if (typeof window.confirm !== 'function') {
  window.confirm = () => false;
}

// Several components rely on ResizeObserver (MessagesTimeline, XTerminal,
// GodView), so install a no-op fallback when the environment lacks it.
class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// xterm.js calls window.matchMedia(...).addListener() in a setTimeout that can
// fire after per-test mocks are cleaned up.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Prevent xterm from mounting in DOM test environments — neither happy-dom nor
// jsdom supports canvas or the deprecated MediaQueryList.addListener API.
// Tests only check React UI elements (settings panel etc), not terminal content.
// (The canvas getContext stub lives in ./canvas-setup.ts, which loads first so
// it is in place before the @xterm/xterm import above probes canvas.)
Terminal.prototype.open = () => {};

