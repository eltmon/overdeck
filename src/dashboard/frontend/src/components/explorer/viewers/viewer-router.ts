// Ported from t3code (MIT, Copyright (c) 2026 T3 Tools Inc.)
// upstream: packages/shared/src/filePreview.ts @ 2d8a843e6b
/**
 * Viewer router (PAN-5188 §6.6). Maps a root-relative path and its
 * explorerReadFile result to the viewer that shows it. The extension rows are
 * drawn from t3code's packages/shared/src/filePreview.ts; the order is
 * Overdeck's.
 *
 * Extension rows come before the read-kind rows: PAN-5185 calls a file binary
 * only when its first 8 KiB holds a NUL, so an ASCII PDF or an uncompressed
 * SVG reads as 'text' and must still reach its viewer.
 *
 * The seam for a code pane (PAN-5187): `pickViewer(path, read).kind === 'text'`
 * opens Monaco; anything else renders `<FileViewer rootId path read />`. When
 * `textEditable` is true the pane may offer a Preview / Edit toggle.
 *
 * Tier 2 (PAN-5189) inserts its office, notebook and mermaid rows with the
 * other extension rows, before the `read.kind === 'text'` row: notebooks and
 * Mermaid files are text reads, so a row after it would never match.
 */
import type { ExplorerReadFileResult } from '@overdeck/contracts';

export type ViewerKind =
  | 'text'
  | 'image'
  | 'svg'
  | 'pdf'
  | 'audio'
  | 'font'
  | 'table'
  | 'large-text'
  | 'archive'
  | 'sqlite'
  | 'binary';

export interface ViewerChoice {
  kind: ViewerKind;
  delimiter: ',' | '\t' | null;
  textEditable: boolean;
}

/** t3code's LARGE_TEXT_MAX_BYTES: the large-text viewer's limit. */
export const LARGE_TEXT_MAX_BYTES = 256 * 1024 * 1024;

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'heif']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2']);
const ARCHIVE = new Set(['zip', 'jar', 'tar', 'gz', 'tgz']);
const SQLITE = new Set(['sqlite', 'sqlite3', 'db']);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function choice(kind: ViewerKind, delimiter: ',' | '\t' | null = null, textEditable = false): ViewerChoice {
  return { kind, delimiter, textEditable };
}

export function pickViewer(path: string, read: Pick<ExplorerReadFileResult, 'kind' | 'size'>): ViewerChoice {
  const ext = extensionOf(path);
  const delimiter = ext === 'csv' ? ',' : ext === 'tsv' ? '\t' : null;
  if (SQLITE.has(ext) && read.kind === 'binary') return choice('sqlite');
  if (ext === 'pdf') return choice('pdf');
  if (IMAGE.has(ext)) return choice('image');
  if (ext === 'svg') return choice('svg', null, read.kind === 'text');
  if (AUDIO.has(ext)) return choice('audio');
  if (FONT.has(ext)) return choice('font');
  if (ARCHIVE.has(ext)) return choice('archive');
  if (delimiter && read.kind === 'text') return choice('table', delimiter, true);
  if (read.kind === 'text') return choice('text');
  if (read.kind === 'large-text' && read.size > LARGE_TEXT_MAX_BYTES) return choice('binary');
  if (read.kind === 'large-text') return choice('large-text', delimiter);
  return choice('binary');
}
