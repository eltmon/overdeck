export type ExcalidrawElement = Record<string, unknown> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
};

const VISIBLE_CANVAS_LIMIT = 100000;

function randomId(): string {
  return `element-${Math.random().toString(36).slice(2, 10)}`;
}

function randomNonce(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeExcalidrawElement(element: Partial<ExcalidrawElement>): ExcalidrawElement {
  const normalized = {
    ...element,
    id: typeof element.id === 'string' && element.id ? element.id : randomId(),
    type: typeof element.type === 'string' && element.type ? element.type : 'rectangle',
    x: finiteNumber(element.x, 0),
    y: finiteNumber(element.y, 0),
    width: Math.max(1, finiteNumber(element.width, 100)),
    height: Math.max(1, finiteNumber(element.height, 100)),
    version: Math.max(1, Math.trunc(finiteNumber(element.version, 1))),
    versionNonce: Math.trunc(finiteNumber(element.versionNonce, randomNonce())),
    isDeleted: element.isDeleted === true,
  } satisfies ExcalidrawElement;

  if (Math.abs(normalized.x) > VISIBLE_CANVAS_LIMIT || Math.abs(normalized.y) > VISIBLE_CANVAS_LIMIT) {
    console.warn(`Excalidraw element ${normalized.id} has coordinates outside visible canvas range`);
  }

  return normalized;
}

export function normalizeElements(elements: readonly Partial<ExcalidrawElement>[]): ExcalidrawElement[] {
  return elements.map((element) => normalizeExcalidrawElement(element));
}
