import type { ExcalidrawElement } from './whiteboard-elements.js';

function textFromElement(element: ExcalidrawElement): string | null {
  for (const key of ['text', 'label', 'originalText', 'rawText']) {
    const value = element[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function extractKeywords(elements: readonly ExcalidrawElement[]): string[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const keywords = new Set<string>();

  for (const element of elements) {
    if (element.type === 'text') {
      const text = textFromElement(element);
      if (text) keywords.add(text);
    }

    const boundElements = Array.isArray(element.boundElements) ? element.boundElements : [];
    for (const bound of boundElements) {
      if (!bound || typeof bound !== 'object') continue;
      const id = 'id' in bound && typeof bound.id === 'string' ? bound.id : null;
      if (!id) continue;
      const boundElement = byId.get(id);
      if (!boundElement || boundElement.type !== 'text') continue;
      const text = textFromElement(boundElement);
      if (text) keywords.add(text);
    }
  }

  return [...keywords];
}

export const extractKeywordsFromElements = extractKeywords;
