/**
 * Download header policy for `GET /api/explorer/download` (PAN-5188, PRD §6.2).
 *
 * Repo files are served from the dashboard origin, so a file must never run as
 * active content with the operator's session. This module picks a passive
 * Content-Type per extension (markup goes out as text/plain, SVG is always an
 * attachment), allows `inline` only for an allow-list of passive types, and adds
 * nosniff plus a sandboxing CSP to every response. Pure: no I/O.
 */
import { extname } from 'node:path';

export const DOWNLOAD_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

const TEXT_PLAIN = 'text/plain; charset=utf-8';
const OCTET_STREAM = 'application/octet-stream';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3',
  db: 'application/vnd.sqlite3',
};

// Markup that a browser would render as a document goes out as plain text.
const MARKUP_AS_TEXT = ['html', 'htm', 'xhtml', 'xht', 'mhtml', 'shtml', 'xml', 'xsl', 'xslt'];
const PLAIN_TEXT = [
  'txt', 'md', 'log', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'yaml', 'yml',
  'toml', 'sh', 'py', 'rs', 'go', 'java', 'c', 'h', 'cpp', 'sql',
];

const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon',
  'image/tiff', 'image/heic', 'image/heif', 'application/pdf', 'text/plain', 'text/csv',
]);

/** The Content-Type for a root-relative path, chosen by its lower-cased extension. */
export function contentTypeForPath(relPath: string): string {
  const ext = extname(relPath).slice(1).toLowerCase();
  if (ext === '') return OCTET_STREAM;
  if (MARKUP_AS_TEXT.includes(ext) || PLAIN_TEXT.includes(ext)) return TEXT_PLAIN;
  return Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext]! : OCTET_STREAM;
}

/** True when a response with this Content-Type may use `Content-Disposition: inline`. */
export function isInlineAllowed(contentType: string): boolean {
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return INLINE_TYPES.has(base) || base.startsWith('audio/') || base.startsWith('font/');
}

/** `<kind>; filename="<ascii>"; filename*=UTF-8''<encoded>` for any file name. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/gu, '_');
  // RFC 5987 attr-char excludes ' ( ) * ! that encodeURIComponent leaves alone.
  const encoded = encodeURIComponent(fileName).replace(
    /[!'()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * The headers for a file download. `size` is the response body length (the slice
 * length for a 206, 0 for a 416) and becomes `Content-Length`.
 */
export function downloadHeaders(
  relPath: string,
  opts: { inline: boolean; size: number },
): Record<string, string> {
  const contentType = contentTypeForPath(relPath);
  const kind = opts.inline && isInlineAllowed(contentType) ? 'inline' : 'attachment';
  const fileName = relPath.split('/').pop() || 'download';
  return {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(kind, fileName),
    'Content-Length': String(opts.size),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': DOWNLOAD_CSP,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  };
}
