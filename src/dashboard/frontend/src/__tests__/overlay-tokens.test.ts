// PAN-4755 FR-1/NFR-1 — the four overlay tokens (--surface-overlay,
// --surface-overlay-field, --border-overlay, --overlay-scrim) must be
// declared with the exact FR-1 values in all six contract selectors,
// Broadsheet's --surface-overlay must sit lighter than --background in
// both modes (so a modal panel reads as raised off the page), and
// --foreground/--muted-foreground must stay >= 4.5:1 on both overlay
// surfaces in every theme scope.
//
// Parse-and-assert like index-css-theme-scopes.test.ts and
// state-tokens-contrast.test.ts: index.css is parsed with postcss and
// values are read from the exact selectors that declare them, so a
// palette edit in index.css is what this test checks.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import type { Rule } from 'postcss';

const CSS_PATH = path.resolve(__dirname, '../index.css');

type Rgb = [number, number, number];

/** prop -> value per exact (whitespace-normalized) selector; the last declaration wins. */
let declsBySelector: Map<string, Map<string, string>>;

beforeAll(() => {
  const root = postcss.parse(readFileSync(CSS_PATH, 'utf8'));
  declsBySelector = new Map();
  root.walkRules((rule: Rule) => {
    for (const raw of rule.selectors) {
      const selector = raw.replace(/\s+/g, ' ').trim();
      const decls = declsBySelector.get(selector) ?? new Map<string, string>();
      rule.each((node) => {
        if (node.type === 'decl' && node.prop.startsWith('--')) decls.set(node.prop, node.value.trim());
      });
      declsBySelector.set(selector, decls);
    }
  });
});

function tokenValue(selector: string, prop: string): string {
  const value = declsBySelector.get(selector)?.get(prop);
  if (value === undefined) throw new Error(`index.css: ${selector} does not declare ${prop}`);
  return value;
}

/** Follows one var(--x) hop to the same selector's own declaration. */
function resolve(selector: string, prop: string): string {
  const raw = tokenValue(selector, prop);
  const varRef = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  return varRef ? tokenValue(selector, varRef[1]!) : raw;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function parseColor(value: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i.exec(value);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  throw new Error(`unsupported color value: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const OVERLAY_PROPS = ['--surface-overlay', '--surface-overlay-field', '--border-overlay', '--overlay-scrim'] as const;

/** FR-1's exact values, keyed by the six contract selectors. */
const FR1: Record<string, Record<(typeof OVERLAY_PROPS)[number], string>> = {
  '[data-theme="ledger"]': {
    '--surface-overlay': 'var(--popover)',
    '--surface-overlay-field': 'var(--background)',
    '--border-overlay': 'var(--border)',
    '--overlay-scrim': 'rgb(0 0 0 / 0.4)',
  },
  '[data-theme="broadsheet"]': {
    '--surface-overlay': 'hsl(40 18% 99.3%)',
    '--surface-overlay-field': 'hsl(30 10% 96.8%)',
    '--border-overlay': 'hsl(30 5% 82%)',
    '--overlay-scrim': 'hsl(35 14% 9% / 0.44)',
  },
  '.dark[data-theme="ledger"]': {
    '--surface-overlay': 'var(--popover)',
    '--surface-overlay-field': 'var(--background)',
    '--border-overlay': 'var(--border)',
    '--overlay-scrim': 'rgb(0 0 0 / 0.56)',
  },
  '.dark [data-theme="ledger"]': {
    '--surface-overlay': 'var(--popover)',
    '--surface-overlay-field': 'var(--background)',
    '--border-overlay': 'var(--border)',
    '--overlay-scrim': 'rgb(0 0 0 / 0.56)',
  },
  '.dark[data-theme="broadsheet"]': {
    '--surface-overlay': 'hsl(30 3% 18.5%)',
    '--surface-overlay-field': 'hsl(0 0% 14.5%)',
    '--border-overlay': 'hsl(30 3% 27%)',
    '--overlay-scrim': 'hsl(0 0% 0% / 0.56)',
  },
  '.dark [data-theme="broadsheet"]': {
    '--surface-overlay': 'hsl(30 3% 18.5%)',
    '--surface-overlay-field': 'hsl(0 0% 14.5%)',
    '--border-overlay': 'hsl(30 3% 27%)',
    '--overlay-scrim': 'hsl(0 0% 0% / 0.56)',
  },
};

/** The four scopes NFR-1's contrast requirement covers (combined selector forms only). */
const CONTRAST_SCOPES = ['[data-theme="ledger"]', '[data-theme="broadsheet"]', '.dark [data-theme="ledger"]', '.dark [data-theme="broadsheet"]'] as const;

describe('index.css — overlay surface tokens (PAN-4755)', () => {
  it.each(Object.keys(FR1))('declares all four overlay tokens with the FR-1 values in %s', (selector) => {
    const expected = FR1[selector]!;
    for (const prop of OVERLAY_PROPS) {
      expect(tokenValue(selector, prop)).toBe(expected[prop]);
    }
  });

  it.each([
    { mode: 'light', selector: '[data-theme="broadsheet"]' },
    { mode: 'dark', selector: '.dark [data-theme="broadsheet"]' },
  ])('Broadsheet --surface-overlay is lighter than --background in $mode', ({ selector }) => {
    const overlay = luminance(parseColor(resolve(selector, '--surface-overlay')));
    const background = luminance(parseColor(resolve(selector, '--background')));
    expect(overlay).toBeGreaterThan(background);
  });

  it.each(CONTRAST_SCOPES)('--foreground and --muted-foreground reach 4.5:1 on both overlay surfaces in %s', (selector) => {
    const failures: string[] = [];
    for (const fgProp of ['--foreground', '--muted-foreground'] as const) {
      const fg = parseColor(resolve(selector, fgProp));
      for (const surfaceProp of ['--surface-overlay', '--surface-overlay-field'] as const) {
        const ratio = contrast(fg, parseColor(resolve(selector, surfaceProp)));
        if (ratio < 4.5) failures.push(`${fgProp} on ${surfaceProp} (${selector}): ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
});
