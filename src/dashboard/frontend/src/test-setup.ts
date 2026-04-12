import '@testing-library/jest-dom';
import { Terminal } from '@xterm/xterm';

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

// jsdom does not implement layout methods. Shim scrollIntoView so components
// that call it during mount/effect (e.g. ComposerPromptEditor's slash-menu
// auto-scroll) don't throw "scrollIntoView is not a function" in tests.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () {};
}
