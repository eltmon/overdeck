import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_CSP,
  contentDisposition,
  contentTypeForPath,
  downloadHeaders,
  isInlineAllowed,
} from '../download-headers.js';

const ACTIVE_TYPES = ['text/html', 'application/xhtml+xml', 'text/xml', 'application/xml'];

describe('contentTypeForPath', () => {
  it.each(['page.html', 'a/b.HTM', 'x.xhtml', 'x.xht', 'x.mhtml', 'x.shtml', 'feed.xml', 'x.xsl', 'x.xslt'])(
    'serves markup %s as text/plain',
    (path) => {
      const type = contentTypeForPath(path);
      expect(type).toBe('text/plain; charset=utf-8');
      expect(ACTIVE_TYPES).not.toContain(type.split(';')[0]);
    },
  );

  it('maps known passive types', () => {
    expect(contentTypeForPath('img/logo.PNG')).toBe('image/png');
    expect(contentTypeForPath('doc.pdf')).toBe('application/pdf');
    expect(contentTypeForPath('data.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeForPath('src/index.ts')).toBe('text/plain; charset=utf-8');
  });

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(contentTypeForPath('blob.bin')).toBe('application/octet-stream');
    expect(contentTypeForPath('Makefile')).toBe('application/octet-stream');
    expect(contentTypeForPath('x.constructor')).toBe('application/octet-stream');
  });
});

describe('isInlineAllowed', () => {
  it('allows passive types and refuses svg, tsv and archives', () => {
    expect(isInlineAllowed('image/png')).toBe(true);
    expect(isInlineAllowed('audio/ogg')).toBe(true);
    expect(isInlineAllowed('font/woff2')).toBe(true);
    expect(isInlineAllowed('text/plain; charset=utf-8')).toBe(true);
    expect(isInlineAllowed('image/svg+xml')).toBe(false);
    expect(isInlineAllowed('text/tab-separated-values; charset=utf-8')).toBe(false);
    expect(isInlineAllowed('application/zip')).toBe(false);
    expect(isInlineAllowed('text/html')).toBe(false);
  });
});

describe('downloadHeaders', () => {
  it('serves .svg as image/svg+xml and always as an attachment', () => {
    const headers = downloadHeaders('art/icon.svg', { inline: true, size: 10 });
    expect(headers['Content-Type']).toBe('image/svg+xml');
    expect(headers['Content-Disposition']).toMatch(/^attachment/u);
  });

  it('serves .html with inline as text/plain', () => {
    const headers = downloadHeaders('index.html', { inline: true, size: 10 });
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(headers['Content-Disposition']).toMatch(/^inline/u);
  });

  it('serves .png inline when asked, attachment otherwise', () => {
    expect(downloadHeaders('a.png', { inline: true, size: 1 })['Content-Disposition']).toMatch(/^inline/u);
    expect(downloadHeaders('a.png', { inline: false, size: 1 })['Content-Disposition']).toMatch(/^attachment/u);
  });

  it('serves an unknown .bin as octet-stream attachment', () => {
    const headers = downloadHeaders('dir/blob.bin', { inline: true, size: 1 });
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Content-Disposition']).toBe(`attachment; filename="blob.bin"; filename*=UTF-8''blob.bin`);
  });

  it.each(['a.png', 'b.svg', 'c.html', 'd.bin', 'e.zip', 'Makefile'])('hardens every response (%s)', (path) => {
    const headers = downloadHeaders(path, { inline: true, size: 42 });
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toBe(DOWNLOAD_CSP);
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(headers['Content-Length']).toBe('42');
  });
});

describe('contentDisposition', () => {
  it('writes an ASCII fallback and an RFC 5987 encoded name', () => {
    expect(contentDisposition('attachment', 'naïve "x".txt')).toBe(
      `attachment; filename="na_ve _x_.txt"; filename*=UTF-8''na%C3%AFve%20%22x%22.txt`,
    );
  });

  it('replaces backslashes and encodes quote characters in filename*', () => {
    expect(contentDisposition('inline', `a\\b'c.txt`)).toBe(
      `inline; filename="a_b'c.txt"; filename*=UTF-8''a%5Cb%27c.txt`,
    );
  });
});
