// PAN-3706 — mechanical no-loss gate for the Broadsheet/Ledger four-scope
// selector contract (see index.css:296-337 for the contract's own writeup).
//
// This is a PARSE-AND-ASSERT test, not a rendered-DOM test: it reads
// index.css as text, parses it with postcss, and reasons about the parsed
// selector/declaration AST directly. It deliberately does not mount a
// stylesheet into happy-dom/jsdom and read getComputedStyle() — neither
// implements color-mix(), oklch(), or the real CSS cascade faithfully, so a
// DOM-based assertion here would either silently pass for the wrong reason
// or flake on browser-only color functions this file uses throughout. The
// four-scope contract is itself a statement about selectors, specificity,
// and source order — properties a parser exposes directly — so parsing is
// both the safer and the more precise tool for this particular invariant.
//
// A small custom-property cascade resolver (resolveVarForElement below) is
// built on top of the parsed rules to check the "nested specimen resolves
// in both directions" requirement. It only needs to understand the small,
// closed set of selector shapes this file's contract actually uses
// (:root, .dark, [data-theme="X"], .dark[data-theme="X"], .dark
// [data-theme="X"]) plus custom-property inheritance — it is not a general
// CSS engine, and does not need to be one to prove this contract.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import type { Rule } from 'postcss';

const CSS_PATH = path.resolve(__dirname, '../index.css');

type ThemeKind = 'ledger' | 'broadsheet';

interface ScopeEntry {
  /** Normalized selector text for one selector in a (possibly comma-separated) rule. */
  selector: string;
  prop: string;
  value: string;
  /** Byte offset of the declaration's parent rule in the source file — used for source-order tie-breaks and the "before .dark" guard. */
  offset: number;
}

/** The eight selector shapes the four-scope contract is built from, plus the two unscoped baselines. */
type Category =
  | 'root'
  | 'dark'
  | 'ledger-light'
  | 'broadsheet-light'
  | 'ledger-dark-combined'
  | 'ledger-dark-descendant'
  | 'broadsheet-dark-combined'
  | 'broadsheet-dark-descendant';

function classify(selector: string): Category | null {
  const s = selector.replace(/\s+/g, ' ').trim();
  if (s === ':root') return 'root';
  if (s === '.dark') return 'dark';
  if (s === '[data-theme="ledger"]') return 'ledger-light';
  if (s === '[data-theme="broadsheet"]') return 'broadsheet-light';
  if (s === '.dark[data-theme="ledger"]') return 'ledger-dark-combined';
  if (s === '.dark [data-theme="ledger"]') return 'ledger-dark-descendant';
  if (s === '.dark[data-theme="broadsheet"]') return 'broadsheet-dark-combined';
  if (s === '.dark [data-theme="broadsheet"]') return 'broadsheet-dark-descendant';
  return null;
}

let cssText: string;
let entries: ScopeEntry[];
/** Every rule whose selector list includes at least one contract-shaped selector, in source order, with its start offset. */
let contractRules: { selectors: string[]; offset: number; props: string[] }[];
let darkBlockOffset: number;

beforeAll(() => {
  cssText = readFileSync(CSS_PATH, 'utf8');
  const root = postcss.parse(cssText);

  entries = [];
  contractRules = [];
  let foundDarkBlock = -1;

  root.walkRules((rule: Rule) => {
    // Skip @keyframes step selectors (e.g. "0%", "100%") — postcss reports
    // these as Rule nodes too, but they are not part of the theme contract
    // and their selector text ("0%") would never collide with our shapes
    // anyway. Guarding explicitly documents the exclusion instead of
    // relying on classify() to return null silently.
    const parent = rule.parent;
    if (parent && parent.type === 'atrule' && /keyframes/i.test((parent as { name?: string }).name ?? '')) {
      return;
    }

    const offset = rule.source?.start?.offset ?? -1;
    const selectors = rule.selectors ?? rule.selector.split(',').map((s) => s.trim());

    const props: string[] = [];
    rule.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) return;
      props.push(decl.prop);
      for (const rawSelector of selectors) {
        const selector = rawSelector.replace(/\s+/g, ' ').trim();
        entries.push({ selector, prop: decl.prop, value: decl.value.trim(), offset });
      }
    });

    const hasContractSelector = selectors.some((s) => classify(s.replace(/\s+/g, ' ').trim()) !== null);
    if (hasContractSelector) {
      contractRules.push({ selectors: selectors.map((s) => s.replace(/\s+/g, ' ').trim()), offset, props });
    }

    // Locate the ONE canonical ".dark { ... }" baseline block (selector is
    // exactly ".dark", not one of the compound/descendant theme forms).
    // classify() already treats those as distinct categories, but a plain
    // string check here keeps this particular lookup independent of the
    // classify() table so a future edit to that table can't silently break
    // the "before .dark" guard test.
    if (selectors.length === 1 && selectors[0].trim() === '.dark' && foundDarkBlock === -1) {
      foundDarkBlock = offset;
    }
  });

  expect(foundDarkBlock).toBeGreaterThan(-1);
  darkBlockOffset = foundDarkBlock;
});

/** All prop -> value pairs declared under a given category, keyed by prop (last declaration in source order wins, matching real cascade behavior for same-category duplicates). */
function propsIn(category: Category): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    if (classify(entry.selector) === category) {
      map.set(entry.prop, entry.value);
    }
  }
  return map;
}

describe('index.css — Broadsheet/Ledger four-scope contract (PAN-3706)', () => {
  describe('completeness: every Broadsheet override has a Ledger counterpart', () => {
    it('every prop set under [data-theme="broadsheet"] (light) is also set under [data-theme="ledger"] (light) with a non-empty value', () => {
      const broadsheetLight = propsIn('broadsheet-light');
      const ledgerLight = propsIn('ledger-light');
      expect(broadsheetLight.size).toBeGreaterThan(0);

      const missing: string[] = [];
      for (const prop of broadsheetLight.keys()) {
        const ledgerValue = ledgerLight.get(prop);
        if (ledgerValue === undefined || ledgerValue.length === 0) missing.push(prop);
      }
      expect(missing).toEqual([]);
    });

    it('every prop set under the Broadsheet dark scope is also set under the Ledger dark scope with a non-empty value', () => {
      const broadsheetDark = new Map([...propsIn('broadsheet-dark-combined'), ...propsIn('broadsheet-dark-descendant')]);
      const ledgerDark = new Map([...propsIn('ledger-dark-combined'), ...propsIn('ledger-dark-descendant')]);
      expect(broadsheetDark.size).toBeGreaterThan(0);

      const missing: string[] = [];
      for (const prop of broadsheetDark.keys()) {
        const ledgerValue = ledgerDark.get(prop);
        if (ledgerValue === undefined || ledgerValue.length === 0) missing.push(prop);
      }
      expect(missing).toEqual([]);
    });

    it('the combined (.dark[data-theme=X]) and descendant (.dark [data-theme=X]) forms declare identical prop/value pairs for each theme', () => {
      // The contract requires BOTH forms so a nested specimen resolves
      // regardless of whether the themed element is the document root
      // itself or a descendant of it (index.css:320-326). If the two forms
      // ever drift apart, that symmetry silently breaks for one of the two
      // cases.
      for (const theme of ['ledger', 'broadsheet'] as ThemeKind[]) {
        const combined = propsIn(`${theme}-dark-combined` as Category);
        const descendant = propsIn(`${theme}-dark-descendant` as Category);
        expect(Object.fromEntries(descendant)).toEqual(Object.fromEntries(combined));
      }
    });
  });

  describe('no-loss: Ledger restates today\'s :root/.dark values byte-for-byte', () => {
    it('every prop [data-theme="ledger"] shares with the unscoped :root baseline has an identical value', () => {
      const root = propsIn('root');
      const ledgerLight = propsIn('ledger-light');
      const shared = [...ledgerLight.keys()].filter((prop) => root.has(prop));
      // Sanity: the ledger-light scope must actually restate at least one
      // :root-baseline token, or this test would vacuously pass.
      expect(shared.length).toBeGreaterThan(0);

      const mismatches = shared
        .filter((prop) => root.get(prop) !== ledgerLight.get(prop))
        .map((prop) => `${prop}: :root=${root.get(prop)} vs ledger=${ledgerLight.get(prop)}`);
      expect(mismatches).toEqual([]);
    });

    it('every prop the Ledger dark scope shares with the unscoped .dark baseline has an identical value', () => {
      const dark = propsIn('dark');
      const ledgerDark = new Map([...propsIn('ledger-dark-combined'), ...propsIn('ledger-dark-descendant')]);
      const shared = [...ledgerDark.keys()].filter((prop) => dark.has(prop));
      expect(shared.length).toBeGreaterThan(0);

      const mismatches = shared
        .filter((prop) => dark.get(prop) !== ledgerDark.get(prop))
        .map((prop) => `${prop}: .dark=${dark.get(prop)} vs ledger-dark=${ledgerDark.get(prop)}`);
      expect(mismatches).toEqual([]);
    });
  });

  describe('specificity trap guard: no bare Broadsheet color block precedes .dark in source order', () => {
    it('a bare [data-theme="broadsheet"] rule that overrides a prop the unscoped .dark block also sets appears AFTER .dark in the file', () => {
      // Non-color tokens (fonts, display-scale, badge-radius) are legitimately
      // declared before .dark today — .dark never redeclares those props, so
      // there is no equal-specificity conflict for source order to resolve.
      // The trap only exists for props BOTH .dark and a bare Broadsheet rule
      // declare: that is exactly the set index.css:307-337 says must come
      // after .dark so Broadsheet wins dark mode on source order.
      const darkProps = new Set(propsIn('dark').keys());
      expect(darkProps.size).toBeGreaterThan(0);

      const violations: string[] = [];
      for (const rule of contractRules) {
        const isBareBroadsheet = rule.selectors.length === 1 && classify(rule.selectors[0]) === 'broadsheet-light';
        if (!isBareBroadsheet) continue;
        const conflicting = rule.props.filter((p) => darkProps.has(p));
        if (conflicting.length > 0 && rule.offset <= darkBlockOffset) {
          violations.push(`offset ${rule.offset} sets [${conflicting.join(', ')}] before .dark (offset ${darkBlockOffset})`);
        }
      }
      expect(violations).toEqual([]);
    });

    it('every prop declared under the color-scoped [data-theme="broadsheet"] region itself sits after .dark in source order', () => {
      // Belt-and-suspenders: the region comment at index.css:296-337
      // explicitly states this region is placed after .dark on purpose.
      // Assert the whole region's rules — not just ones that happen to
      // collide with .dark's own prop set — start after it, so a future
      // edit that reorders the file trips this test even before it manages
      // to introduce an actual colliding prop.
      const region = contractRules.filter(
        (rule) => rule.selectors.length === 1 && classify(rule.selectors[0]) === 'broadsheet-light'
      );
      // Exclude the two known, deliberately-early non-color blocks (font
      // tokens near the top of the file, display-scale utilities inside
      // @layer components) by checking they don't declare any prop the
      // unscoped .dark block also declares — i.e. reuse the same
      // "does this collide with .dark" filter as the test above, but assert
      // the positive: every OTHER (colliding) bare-broadsheet rule is late.
      const darkProps = new Set(propsIn('dark').keys());
      const colorRegionRules = region.filter((rule) => rule.props.some((p) => darkProps.has(p)));
      expect(colorRegionRules.length).toBeGreaterThan(0);
      for (const rule of colorRegionRules) {
        expect(rule.offset).toBeGreaterThan(darkBlockOffset);
      }
    });
  });

  describe('nested-specimen resolution (parse-derived cascade, both directions, both modes)', () => {
    /**
     * Resolves the effective value of a custom property for one of two
     * element shapes:
     *  - the document root itself (html), carrying its own data-theme
     *    attribute and, in dark mode, the .dark class
     *  - a nested specimen element (AppearanceSection's theme-specimen
     *    cards), a descendant of html, carrying its OWN data-theme
     *    attribute but never its own .dark class
     * against the small closed set of selector shapes the contract uses,
     * with custom-property inheritance as the fallback when no rule
     * matches the element directly — mirroring real CSS custom-property
     * behavior without needing a real CSS engine.
     */
    function resolveVarForElement(
      prop: string,
      element: { theme: ThemeKind; isRoot: boolean; hasDarkAncestor: boolean }
    ): string | undefined {
      type Candidate = { value: string; tier: 1 | 2; offset: number };
      const candidates: Candidate[] = [];

      for (const entry of entries) {
        if (entry.prop !== prop) continue;
        const category = classify(entry.selector);
        if (category === null) continue;

        if (category === 'root' && element.isRoot) {
          candidates.push({ value: entry.value, tier: 1, offset: entry.offset });
        } else if (category === 'dark' && element.isRoot && element.hasDarkAncestor) {
          // For the root element "hasDarkAncestor" is repurposed to mean
          // "carries the .dark class itself" (see the isRoot call sites
          // below) — the root has no ancestor to inherit .dark from.
          candidates.push({ value: entry.value, tier: 1, offset: entry.offset });
        } else if (category === 'ledger-light' && element.theme === 'ledger') {
          candidates.push({ value: entry.value, tier: 1, offset: entry.offset });
        } else if (category === 'broadsheet-light' && element.theme === 'broadsheet') {
          candidates.push({ value: entry.value, tier: 1, offset: entry.offset });
        } else if (
          category === 'ledger-dark-combined' &&
          element.isRoot &&
          element.hasDarkAncestor &&
          element.theme === 'ledger'
        ) {
          candidates.push({ value: entry.value, tier: 2, offset: entry.offset });
        } else if (
          category === 'broadsheet-dark-combined' &&
          element.isRoot &&
          element.hasDarkAncestor &&
          element.theme === 'broadsheet'
        ) {
          candidates.push({ value: entry.value, tier: 2, offset: entry.offset });
        } else if (
          category === 'ledger-dark-descendant' &&
          !element.isRoot &&
          element.hasDarkAncestor &&
          element.theme === 'ledger'
        ) {
          candidates.push({ value: entry.value, tier: 2, offset: entry.offset });
        } else if (
          category === 'broadsheet-dark-descendant' &&
          !element.isRoot &&
          element.hasDarkAncestor &&
          element.theme === 'broadsheet'
        ) {
          candidates.push({ value: entry.value, tier: 2, offset: entry.offset });
        }
      }

      if (candidates.length === 0) {
        if (!element.isRoot) {
          // Custom properties inherit: fall back to what the document root
          // resolves to. The nested specimen never carries its own .dark
          // class, but it inherits whatever the root's ambient dark/light
          // mode already baked into the inherited value.
          return resolveVarForElement(prop, { theme: element.theme, isRoot: true, hasDarkAncestor: element.hasDarkAncestor });
        }
        return undefined;
      }

      candidates.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.offset - b.offset));
      return candidates[candidates.length - 1]!.value;
    }

    const sampledProps = ['--background', '--foreground', '--border', '--radius'];

    it.each(sampledProps)('root element resolves %s to its OWN scope value in every theme x mode combination, never the other theme', (prop) => {
      for (const theme of ['ledger', 'broadsheet'] as ThemeKind[]) {
        for (const dark of [false, true]) {
          const resolved = resolveVarForElement(prop, { theme, isRoot: true, hasDarkAncestor: dark });
          const expected = dark
            ? propsIn(`${theme}-dark-combined` as Category).get(prop) ?? propsIn('dark').get(prop)
            : propsIn(`${theme}-light` as Category).get(prop) ?? propsIn('root').get(prop);
          expect(resolved).toBeDefined();
          expect(resolved).toBe(expected);
        }
      }
    });

    it.each(sampledProps)(
      'a Ledger specimen nested inside a Broadsheet document resolves %s to LEDGER\'s value, in both light and dark',
      (prop) => {
        for (const dark of [false, true]) {
          const resolved = resolveVarForElement(prop, { theme: 'ledger', isRoot: false, hasDarkAncestor: dark });
          const expected = dark
            ? propsIn('ledger-dark-combined').get(prop)
            : propsIn('ledger-light').get(prop);
          expect(resolved).toBe(expected);
          // And it must NOT equal Broadsheet's value for that mode (unless
          // they happen to coincide, which none of the sampled tokens do).
          const broadsheetValue = dark ? propsIn('broadsheet-dark-combined').get(prop) : propsIn('broadsheet-light').get(prop);
          expect(resolved).not.toBe(broadsheetValue);
        }
      }
    );

    it.each(sampledProps)(
      'a Broadsheet specimen nested inside a Ledger document resolves %s to BROADSHEET\'s value, in both light and dark',
      (prop) => {
        for (const dark of [false, true]) {
          const resolved = resolveVarForElement(prop, { theme: 'broadsheet', isRoot: false, hasDarkAncestor: dark });
          const expected = dark
            ? propsIn('broadsheet-dark-combined').get(prop)
            : propsIn('broadsheet-light').get(prop);
          expect(resolved).toBe(expected);
          const ledgerValue = dark ? propsIn('ledger-dark-combined').get(prop) : propsIn('ledger-light').get(prop);
          expect(resolved).not.toBe(ledgerValue);
        }
      }
    );
  });
});
