import '@testing-library/jest-dom';
import { Terminal } from '@xterm/xterm';

// jsdom doesn't implement scrollIntoView — mock it globally
Element.prototype.scrollIntoView = () => {};

// jsdom doesn't ship ResizeObserver. Several components rely on it
// (MessagesTimeline, XTerminal, GodView) so we install a no-op global mock.
class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = ResizeObserverMock;
}

// Mock matchMedia globally — xterm.js calls window.matchMedia(...).addListener()
// in a setTimeout that can fire after per-test mocks are cleaned up.
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

// Prevent xterm from trying to mount into jsdom — jsdom doesn't support canvas
// or the deprecated MediaQueryList.addListener that xterm.js uses for DPR tracking.
// Tests only check React UI elements (settings panel etc), not terminal content.
Terminal.prototype.open = () => {};

