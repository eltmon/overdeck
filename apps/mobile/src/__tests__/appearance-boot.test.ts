import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { APPEARANCE_KEY } from '../shell/appearance';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(path.join(appRoot, 'index.html'), 'utf8');

function extractBootScript(): string {
  const scripts = [...html.matchAll(/<script(?![^>]*\stype=)[^>]*>([\s\S]*?)<\/script>/g)];
  const match = scripts.find(([, body]) => body.includes(APPEARANCE_KEY));
  if (!match) throw new Error('appearance boot script not found in index.html');
  return match[1];
}

const bootScript = extractBootScript();

function runBoot() {
  new Function(bootScript)();
}

describe('PAN-5041 appearance boot script', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function stubMatchMedia(matches: boolean) {
    window.matchMedia = () => ({ matches }) as MediaQueryList;
  }

  it("'light' leaves no dark class and mirrors overdeck.ui.theme to 'light'", () => {
    localStorage.setItem(APPEARANCE_KEY, 'light');
    stubMatchMedia(true);

    runBoot();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('overdeck.ui.theme')).toBe('light');
  });

  it("'dark' adds the dark class", () => {
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    stubMatchMedia(false);

    runBoot();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('overdeck.ui.theme')).toBe('dark');
  });

  it("'system' with matchMedia dark adds the dark class", () => {
    localStorage.setItem(APPEARANCE_KEY, 'system');
    stubMatchMedia(true);

    runBoot();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('overdeck.ui.theme')).toBe('dark');
  });

  it('a missing key with matchMedia light leaves no dark class', () => {
    stubMatchMedia(false);

    runBoot();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('overdeck.ui.theme')).toBe('light');
  });
});
