import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAurora } from '../aurora';

interface MockWebGl {
  gl: WebGLRenderingContext;
  shaderSource: ReturnType<typeof vi.fn>;
  uniform1f: ReturnType<typeof vi.fn>;
  uniform2f: ReturnType<typeof vi.fn>;
  drawArrays: ReturnType<typeof vi.fn>;
  viewport: ReturnType<typeof vi.fn>;
  deleteBuffer: ReturnType<typeof vi.fn>;
  deleteShader: ReturnType<typeof vi.fn>;
  deleteProgram: ReturnType<typeof vi.fn>;
  locations: {
    res: WebGLUniformLocation;
    time: WebGLUniformLocation;
    energy: WebGLUniformLocation;
  };
}

function createMockWebGl(compileSucceeds = true): MockWebGl {
  const vertexShader = {} as WebGLShader;
  const fragmentShader = {} as WebGLShader;
  const program = {} as WebGLProgram;
  const buffer = {} as WebGLBuffer;
  const locations = {
    res: {} as WebGLUniformLocation,
    time: {} as WebGLUniformLocation,
    energy: {} as WebGLUniformLocation,
  };
  const shaderSource = vi.fn();
  const uniform1f = vi.fn();
  const uniform2f = vi.fn();
  const drawArrays = vi.fn();
  const viewport = vi.fn();
  const deleteBuffer = vi.fn();
  const deleteShader = vi.fn();
  const deleteProgram = vi.fn();

  const gl = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    createShader: vi.fn((type: number) => type === 0x8b31 ? vertexShader : fragmentShader),
    shaderSource,
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compileSucceeds),
    getShaderInfoLog: vi.fn(() => 'shader compile failed'),
    createProgram: vi.fn(() => program),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => buffer),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((_program: WebGLProgram, name: string) => locations[name === 'uRes' ? 'res' : name === 'uTime' ? 'time' : 'energy']),
    uniform1f,
    uniform2f,
    drawArrays,
    viewport,
    deleteBuffer,
    deleteShader,
    deleteProgram,
  } as unknown as WebGLRenderingContext;

  return {
    gl,
    shaderSource,
    uniform1f,
    uniform2f,
    drawArrays,
    viewport,
    deleteBuffer,
    deleteShader,
    deleteProgram,
    locations,
  };
}

function useContext(canvas: HTMLCanvasElement, context: WebGLRenderingContext | null): void {
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: vi.fn(() => context),
  });
}

describe('createAurora', () => {
  let frame: FrameRequestCallback | undefined;
  let hidden = false;

  beforeEach(() => {
    frame = undefined;
    hidden = false;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 17;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ports the union shaders and drives the full-window WebGL background', () => {
    const canvas = document.createElement('canvas');
    const mock = createMockWebGl();
    useContext(canvas, mock.gl);

    const aurora = createAurora(canvas);

    expect(mock.shaderSource).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}',
    );
    const fragmentShader = mock.shaderSource.mock.calls[1]?.[1] as string;
    expect(fragmentShader).toContain('float fbm(vec2 p)');
    expect(fragmentShader).toContain('/* aurora bands (river) */');
    expect(fragmentShader).toContain('/* starfield twinkle */');
    expect(fragmentShader).toContain('/* perspective grid floor (spectrum deck) */');
    expect(canvas.style.position).toBe('fixed');
    expect(canvas.style.inset).toBe('0');
    expect(canvas.style.zIndex).toBe('0');
    expect(mock.viewport).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);

    aurora.setEnergy(.72);
    expect(mock.uniform1f).toHaveBeenCalledWith(mock.locations.energy, .72);

    frame?.(performance.now() + 16);
    expect(mock.uniform2f).toHaveBeenCalledWith(mock.locations.res, canvas.width, canvas.height);
    expect(mock.uniform1f).toHaveBeenCalledWith(mock.locations.energy, .72);
    expect(mock.drawArrays).toHaveBeenCalledWith(mock.gl.TRIANGLES, 0, 3);

    aurora.dispose();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(mock.deleteBuffer).toHaveBeenCalledOnce();
    expect(mock.deleteShader).toHaveBeenCalledTimes(2);
    expect(mock.deleteProgram).toHaveBeenCalledOnce();
  });

  it('skips uniform updates while the document is hidden', () => {
    const canvas = document.createElement('canvas');
    const mock = createMockWebGl();
    useContext(canvas, mock.gl);
    const aurora = createAurora(canvas);
    mock.uniform1f.mockClear();
    mock.uniform2f.mockClear();
    mock.drawArrays.mockClear();

    hidden = true;
    aurora.setEnergy(.91);
    frame?.(performance.now() + 16);

    expect(mock.uniform1f).not.toHaveBeenCalled();
    expect(mock.uniform2f).not.toHaveBeenCalled();
    expect(mock.drawArrays).not.toHaveBeenCalled();

    hidden = false;
    frame?.(performance.now() + 32);
    expect(mock.uniform1f).toHaveBeenCalledWith(mock.locations.energy, .91);

    aurora.dispose();
  });

  it('returns a static null-GL controller when context creation fails', () => {
    const canvas = document.createElement('canvas');
    useContext(canvas, null);

    let aurora: ReturnType<typeof createAurora> | undefined;
    expect(() => {
      aurora = createAurora(canvas);
    }).not.toThrow();

    expect(canvas.style.background).toContain('radial-gradient');
    expect(() => aurora?.setEnergy(.5)).not.toThrow();
    expect(() => aurora?.resize()).not.toThrow();
    expect(() => aurora?.dispose()).not.toThrow();
  });

  it('falls back without throwing when shader compilation fails', () => {
    const canvas = document.createElement('canvas');
    const mock = createMockWebGl(false);
    useContext(canvas, mock.gl);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    let aurora: ReturnType<typeof createAurora> | undefined;
    expect(() => {
      aurora = createAurora(canvas);
    }).not.toThrow();

    expect(console.warn).toHaveBeenCalledWith(
      'WebGL unavailable, canvas-only mode',
      expect.any(Error),
    );
    expect(canvas.style.background).toContain('radial-gradient');
    expect(() => aurora?.setEnergy(.5)).not.toThrow();
  });
});
