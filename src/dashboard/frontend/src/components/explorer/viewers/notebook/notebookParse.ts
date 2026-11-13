// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/extendedDocumentPreview.ts @ 2d8a843e6b
import { decodeHTMLAttribute } from 'entities';

import { IMAGE_DIMENSIONS_HEADER_BYTES, readImageDimensions } from '../shared/imageDimensions';

export type NotebookCell = {
  readonly kind: 'markdown' | 'code' | 'raw';
  readonly source: string;
  readonly outputs: { readonly kind: 'text' | 'image' | 'html'; readonly text: string }[];
};

export type ParsedNotebook = { language: string; cells: NotebookCell[] };

function imageFits(bytes: Uint8Array) {
  const size = readImageDimensions(bytes.subarray(0, IMAGE_DIMENSIONS_HEADER_BYTES));
  return size !== null && size.width <= 16_777_216 / size.height;
}
function base64ImageFits(base64: string) {
  return (
    /^[a-z\d+/]*={0,2}$/i.test(base64) &&
    base64.length % 4 !== 1 &&
    (!base64.endsWith('=') || base64.length % 4 === 0) &&
    imageFits(
      Uint8Array.from(
        atob(base64.slice(0, 4 * Math.ceil(IMAGE_DIMENSIONS_HEADER_BYTES / 3))),
        (char) => char.charCodeAt(0),
      ),
    )
  );
}
function htmlImagesFit(html: string) {
  // HTML attribute entities can obscure a data URL until the client parses it.
  for (const match of decodeHTMLAttribute(html).matchAll(
    /data:image\/(?:png|jpeg|gif|webp);base64,([a-z\d+/]*={0,2})/gi,
  ))
    if (!base64ImageFits(match[1]!)) return false;
  return true;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function notebookText(value: unknown, limit = 256_000): string {
  const result =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value.filter((part) => typeof part === 'string').join('')
        : '';
  if (result.length > limit) throw new Error('A notebook cell is too large to preview.');
  return result;
}
export function openNotebook(bytes: ArrayBuffer): ParsedNotebook {
  if (bytes.byteLength > 8 * 1024 * 1024)
    throw new Error('Notebook preview limited to files under 8 MB.');
  const notebook = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells) || notebook.cells.length > 500)
    throw new Error('Preview supports version 4 notebooks with up to 500 cells.');
  const language = String(record(record(notebook.metadata).language_info).name ?? 'text')
    .replaceAll(/[^a-z\d+#-]/gi, '')
    .slice(0, 40);
  const cells: NotebookCell[] = notebook.cells.map((value) => {
    const cell = record(value);
    const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
    if (outputs.length > 100) throw new Error('A notebook cell has too many outputs to preview.');
    return {
      kind: cell.cell_type === 'markdown' ? 'markdown' : cell.cell_type === 'code' ? 'code' : 'raw',
      source: notebookText(cell.source),
      outputs: outputs
        .map((value) => {
          const output = record(value);
          const data = record(output.data);
          for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
            if (data[mime]) {
              const base64 = notebookText(data[mime], 4 * 1024 * 1024).replaceAll(/\s/g, '');
              if (base64ImageFits(base64))
                return { kind: 'image' as const, text: `data:${mime};base64,${base64}` };
            }
          }
          const html = notebookText(data['text/html']);
          if (html.trim() && htmlImagesFit(html)) return { kind: 'html' as const, text: html };
          return {
            kind: 'text' as const,
            text: notebookText(output.text ?? data['text/plain'] ?? output.traceback),
          };
        })
        .filter((output) => output.text.trim().length > 0),
    };
  });
  return { language, cells };
}
