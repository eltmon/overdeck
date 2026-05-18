import { normalizeElements, type ExcalidrawElement } from './whiteboard-elements.js';

export type WhiteboardEditOperation = {
  action: 'replace' | 'insert_after' | 'delete';
  lineNumber: number;
  element?: Partial<ExcalidrawElement>;
};

export type Op = WhiteboardEditOperation;

function describeElement(element: ExcalidrawElement): string {
  const text = typeof element.text === 'string' && element.text ? ` text=${JSON.stringify(element.text)}` : '';
  return `${element.type}${text} at (${element.x},${element.y})`;
}

export function formatLineNumberedWhiteboard(elements: readonly ExcalidrawElement[]): string {
  if (elements.length === 0) return '(empty whiteboard)';
  return elements.map((element, index) => `${index + 1}: ${describeElement(element)}`).join('\n');
}

export function applyWhiteboardEditOperations(
  elements: readonly ExcalidrawElement[],
  ops: readonly WhiteboardEditOperation[]
): ExcalidrawElement[] {
  const next = [...elements];

  for (const op of ops) {
    const index = op.lineNumber - 1;
    if (index < 0 || index >= next.length) {
      if (op.action === 'insert_after' && index === next.length) {
        if (op.element) next.push(normalizeElements([op.element])[0]);
        continue;
      }
      throw new Error(`Invalid whiteboard line number ${op.lineNumber}`);
    }

    if (op.action === 'delete') {
      next.splice(index, 1);
    } else if (op.action === 'replace') {
      if (!op.element) throw new Error('replace operation requires element');
      next.splice(index, 1, normalizeElements([{ ...next[index], ...op.element }])[0]);
    } else {
      if (!op.element) throw new Error('insert_after operation requires element');
      next.splice(index + 1, 0, normalizeElements([op.element])[0]);
    }
  }

  return next;
}
