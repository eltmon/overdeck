// Loaded FIRST (see vitest.config.ts `setupFiles` order) so the canvas stub is
// installed before any module that probes canvas on import — e.g. @xterm/xterm,
// imported by ./test-setup.ts. ES `import` statements hoist, so a stub defined
// at the bottom of test-setup.ts would run *after* that import and still let one
// "Not implemented" error escape per test file.
//
// jsdom has no canvas backend: every getContext() call otherwise logs
// "Not implemented: HTMLCanvasElement.getContext()" and returns null.
// HealthHistoryChart, GodView/CanvasTerminal and VoiceWidget draw into a canvas;
// tests assert React output, never pixels. Return a cheap no-op 2D context so
// renders stay silent instead of error-spamming on every render. (PAN-1989)
const noopContext2d = new Proxy(
  {
    canvas: document.createElement('canvas'),
    measureText: () => ({ width: 0 }) as TextMetrics,
    getImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }) as ImageData,
    createImageData: () => ({ data: new Uint8ClampedArray(0), width: 0, height: 0 }) as ImageData,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createPattern: () => null,
  },
  {
    // Any other 2D-context member (fillRect, beginPath, stroke, …) → no-op fn.
    get: (target, prop) => (prop in target ? Reflect.get(target, prop) : () => {}),
  },
);

HTMLCanvasElement.prototype.getContext = (() =>
  noopContext2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
