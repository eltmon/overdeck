// @vitest-environment node
/**
 * PAN-3410 WI-1: fonts must be fully self-hosted — no Google Fonts CDN
 * requests from either theme, and every self-hosted font asset must actually
 * exist on disk with its license, within the ~500KB combined budget (NFR-2).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/unit/dashboard/ → repo root (two directories up).
const REPO_ROOT = path.resolve(__dirname, '../../..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'src/dashboard/frontend');
const FONTS_DIR = path.join(FRONTEND_ROOT, 'public/fonts');

const INDEX_HTML = readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf8');
const INDEX_CSS = readFileSync(path.join(FRONTEND_ROOT, 'src/index.css'), 'utf8');

const GOOGLE_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const WOFF2_FILES = [
  'Geist-Variable.woff2',
  'GeistMono-Variable.woff2',
  'DMSans-Variable.woff2',
  'SpaceGrotesk-Variable.woff2',
];

const LICENSE_FILES = ['OFL-Geist.txt', 'OFL-GeistMono.txt', 'OFL-DMSans.txt', 'OFL-SpaceGrotesk.txt'];

const MAX_TOTAL_WOFF2_BYTES = 500 * 1024;

describe('self-hosted fonts (PAN-3410)', () => {
  it('index.html contains zero Google Fonts CDN references', () => {
    for (const host of GOOGLE_FONT_HOSTS) {
      expect(INDEX_HTML.includes(host), `index.html must not reference ${host}`).toBe(false);
    }
  });

  it('index.css contains zero Google Fonts CDN references', () => {
    for (const host of GOOGLE_FONT_HOSTS) {
      expect(INDEX_CSS.includes(host), `index.css must not reference ${host}`).toBe(false);
    }
  });

  it('index.css declares @font-face for all four self-hosted families', () => {
    expect(INDEX_CSS).toMatch(/@font-face\s*{\s*font-family:\s*'Geist Variable'/);
    expect(INDEX_CSS).toMatch(/@font-face\s*{\s*font-family:\s*'Geist Mono Variable'/);
    expect(INDEX_CSS).toMatch(/@font-face\s*{\s*font-family:\s*'DM Sans'/);
    expect(INDEX_CSS).toMatch(/@font-face\s*{\s*font-family:\s*'Space Grotesk'/);
    expect(INDEX_CSS).toContain('font-display: swap');
  });

  it('every self-hosted woff2 file exists on disk', () => {
    for (const file of WOFF2_FILES) {
      const filePath = path.join(FONTS_DIR, file);
      expect(existsSync(filePath), `${file} must exist at ${filePath}`).toBe(true);
    }
  });

  it('every font family has an OFL license file on disk', () => {
    for (const file of LICENSE_FILES) {
      const filePath = path.join(FONTS_DIR, file);
      expect(existsSync(filePath), `${file} must exist at ${filePath}`).toBe(true);
      expect(readFileSync(filePath, 'utf8')).toContain('SIL OPEN FONT LICENSE');
    }
  });

  it('the combined woff2 payload stays within the 500KB budget', () => {
    const totalBytes = WOFF2_FILES.reduce((sum, file) => {
      return sum + statSync(path.join(FONTS_DIR, file)).size;
    }, 0);

    expect(totalBytes).toBeLessThanOrEqual(MAX_TOTAL_WOFF2_BYTES);
  });
});
