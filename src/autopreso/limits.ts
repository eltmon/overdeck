import type { ExcalidrawElementLike } from './session.js';

export const MAX_AUTOPRESO_START_BODY_BYTES = 256_000;
export const MAX_AUTOPRESO_CANVAS_ELEMENTS = 500;
export const MAX_AUTOPRESO_CANVAS_BYTES = 128_000;

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export function readElementLikes(body: unknown): readonly ExcalidrawElementLike[] {
  if (!body || typeof body !== 'object' || !('elements' in body)) return [];
  const elements = (body as { elements?: unknown }).elements;
  return Array.isArray(elements) ? elements.filter((element): element is ExcalidrawElementLike => !!element && typeof element === 'object') : [];
}

export function validateAutoPresoCanvasElements(elements: readonly ExcalidrawElementLike[]): { ok: true } | { ok: false; error: string } {
  if (elements.length > MAX_AUTOPRESO_CANVAS_ELEMENTS) {
    return { ok: false, error: `AutoPreso canvas exceeds ${MAX_AUTOPRESO_CANVAS_ELEMENTS} elements` };
  }
  if (jsonByteLength(elements) > MAX_AUTOPRESO_CANVAS_BYTES) {
    return { ok: false, error: `AutoPreso canvas exceeds ${MAX_AUTOPRESO_CANVAS_BYTES} bytes` };
  }
  return { ok: true };
}

export function boundedAutoPresoElements(elements: readonly ExcalidrawElementLike[]): readonly ExcalidrawElementLike[] {
  const limited = elements.slice(0, MAX_AUTOPRESO_CANVAS_ELEMENTS);
  while (limited.length > 0 && jsonByteLength(limited) > MAX_AUTOPRESO_CANVAS_BYTES) {
    limited.pop();
  }
  return limited;
}
