// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: apps/web/src/components/files/officePreviewProtocol.ts @ 2d8a843e6b
export type OfficeDocumentKind = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp';
export const OFFICE_DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
]);

export const OFFICE_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
export const OFFICE_PREVIEW_MAX_ROWS = 250_000;
export const OFFICE_PREVIEW_MAX_COLUMNS = 1024;

/** What a workbook's views ask of the preview that its engine does not read. */
export type WorkbookView = {
  /** The sheets, by index in workbook order, whose view hides gridlines. */
  readonly hiddenGridlines: readonly number[];
  /** The theme's heading and body fonts, which chart text names as `+mj-lt` and `+mn-lt`. */
  readonly themeFonts: { readonly major: string; readonly minor: string };
};

export type OfficeWorkerRequest =
  | { readonly type: 'open'; readonly kind: OfficeDocumentKind; readonly bytes: ArrayBuffer }
  | { readonly type: 'sheet-page'; readonly sheet: number; readonly index: number };

export type OfficeWorkerResult =
  | {
      readonly type: 'document';
      readonly navigation: 'page' | 'slide' | 'chapter';
      readonly pages: { title: string; html: string }[];
    }
  | { readonly type: 'error'; readonly message: string }
  | {
      readonly type: 'docx' | 'xlsx' | 'pptx';
      readonly bytes: ArrayBuffer;
      readonly truncated: boolean;
      /** For a workbook; undefined for other files. */
      readonly view: WorkbookView | undefined;
    }
  | {
      readonly type: 'ods';
      readonly sheets: {
        name: string;
        rows: string[][];
        truncated: boolean;
        rowCount: number;
        columns: number;
      }[];
    }
  | {
      readonly type: 'sheet-page';
      readonly sheet: number;
      readonly index: number;
      readonly rows: string[][];
    };
