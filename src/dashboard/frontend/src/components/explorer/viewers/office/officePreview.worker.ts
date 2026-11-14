// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/officePreview.worker.ts @ 2d8a843e6b
import { PREVIEW_PAGE_ROWS } from '../large-text/largeTextProtocol';
import { boundedArchive, prepareOffice } from './officeArchive';
import type { OfficeWorkerRequest, OfficeWorkerResult } from './officePreviewProtocol';

let workbook: string[][][] = [];
function reply(result: OfficeWorkerResult) {
  self.postMessage(result, { transfer: 'bytes' in result ? [result.bytes] : [] });
}
async function handle(input: OfficeWorkerRequest) {
  if (input.type === 'sheet-page') {
    const rows = workbook[input.sheet];
    if (!rows) throw new Error('This sheet is unavailable.');
    reply({
      type: 'sheet-page',
      sheet: input.sheet,
      index: input.index,
      rows: rows.slice(input.index * PREVIEW_PAGE_ROWS, (input.index + 1) * PREVIEW_PAGE_ROWS),
    });
    return;
  }
  if (input.kind === 'docx' || input.kind === 'xlsx' || input.kind === 'pptx') {
    reply({ type: input.kind, ...(await prepareOffice(input.bytes, input.kind)) });
    return;
  }
  const { openDocument } = await import('./extendedDocumentPreview');
  const { archive } = await boundedArchive(input);
  const result = await openDocument(archive, input.kind);
  if (result.type === 'ods') {
    workbook = result.sheets.map((sheet) => sheet.rows);
    reply({
      ...result,
      sheets: result.sheets.map((sheet) => ({
        ...sheet,
        rows: sheet.rows.slice(0, PREVIEW_PAGE_ROWS),
      })),
    });
  } else reply(result);
}
self.addEventListener('message', (event: MessageEvent<OfficeWorkerRequest>) => {
  void handle(event.data).catch((cause: unknown) =>
    reply({
      type: 'error',
      message: cause instanceof Error ? cause.message : 'Could not parse this file.',
    }),
  );
});
