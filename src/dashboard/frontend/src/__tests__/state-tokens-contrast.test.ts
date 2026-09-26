// PAN-4197 NFR-1 — every agent state `--state-*-foreground` token must stay
// readable (WCAG contrast >= 4.5:1) on the background and card surfaces of
// both themes (Ledger, Broadsheet) in both modes, and "live" must never be
// green (running is never green).
//
// Parse-and-assert like index-css-theme-scopes.test.ts: index.css is parsed
// with postcss and the surface values are read from the exact selectors that
// declare them, so a palette edit in index.css is what this test checks.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import type { Rule } from 'postcss';

const CSS_PATH = path.resolve(__dirname, '../index.css');
const STATES = ['live', 'needs-you', 'stuck', 'waiting', 'done'] as const;

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

function hue([r, g, b]: Rgb): number {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  if (d === 0) return 0;
  const h = max === rn ? ((gn - bn) / d) % 6 : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return (h * 60 + 360) % 360;
}

/** The NFR-1 surfaces; each mode's state tokens come from its baseline scope. */
const MODES = [
  {
    mode: 'light',
    tokenScope: ':root',
    surfaces: [
      { name: 'Ledger light --background', selector: ':root', prop: '--background' },
      { name: 'Ledger light --card', selector: ':root', prop: '--card' },
      { name: 'Broadsheet light --background', selector: '[data-theme="broadsheet"]', prop: '--background' },
      { name: 'Broadsheet light --card', selector: '[data-theme="broadsheet"]', prop: '--card' },
    ],
  },
  {
    mode: 'dark',
    tokenScope: '.dark',
    surfaces: [
      { name: 'Ledger dark --background', selector: '.dark', prop: '--background' },
      { name: 'Ledger dark --card', selector: '.dark', prop: '--card' },
      { name: 'Broadsheet dark --background', selector: '.dark [data-theme="broadsheet"]', prop: '--background' },
      { name: 'Broadsheet dark --card', selector: '.dark [data-theme="broadsheet"]', prop: '--card' },
    ],
  },
] as const;

describe('index.css — agent state color tokens (PAN-4197)', () => {
  it.each(MODES)('every --state-*-foreground has >= 4.5:1 contrast on every $mode surface', ({ tokenScope, surfaces }) => {
    const failures: string[] = [];
    for (const state of STATES) {
      const prop = `--state-${state}-foreground`;
      const fg = parseColor(tokenValue(tokenScope, prop));
      for (const surface of surfaces) {
        const ratio = contrast(fg, parseColor(tokenValue(surface.selector, surface.prop)));
        if (ratio < 4.5) failures.push(`${prop} (${tokenScope}) on ${surface.name}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(MODES)('declares a base token beside every foreground token in $tokenScope', ({ tokenScope }) => {
    for (const state of STATES) {
      expect(() => parseColor(tokenValue(tokenScope, `--state-${state}`))).not.toThrow();
    }
  });

  it.each(MODES)('--state-live and --state-live-foreground stay out of the green hue band in $tokenScope', ({ tokenScope }) => {
    const green: string[] = [];
    for (const prop of ['--state-live', '--state-live-foreground']) {
      const h = hue(parseColor(tokenValue(tokenScope, prop)));
      if (h >= 90 && h <= 170) green.push(`${prop} (${tokenScope}) hue ${h.toFixed(0)}°`);
    }
    expect(green).toEqual([]);
  });
});
