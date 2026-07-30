/**
 * PAN-2908 · §3.9 Conformance gates — the anti-drift contract, in CI.
 *
 * Convergence without a conformance gate drifts (the lesson of the last two
 * redesigns). These are grep-style gates over the frontend source tree:
 *
 * 1. SINGLE SHELL — the issue-detail anatomy has exactly one topology.
 *    The shared anatomy pieces (IssueDetail / IssueDetailShell /
 *    DrawerAgentSession) may only be imported by their current consumers;
 *    a NEW importer means someone is re-forking a shell, and this fails.
 *    Deleted pieces (DrawerTabs) stay deleted.
 *
 * 2. SINGLE MENU SKIN — one grouped body (IssueActionGroupedBody) behind
 *    one skin (IssueActionMenu) plus its context-menu primitive adapter.
 *    The deleted skins (IssueActionMegaMenu, IssueAgentCard) stay deleted.
 *
 * 3. VOCABULARY — the six-word phase model (Plan·Work·Review·Test·Ship·Done)
 *    is the only phase vocabulary. Legacy label sets (Triaged/Implemented/
 *    Reviewed, Planned/Building/Reviewing/Testing/Shipping) never re-enter
 *    the tree as rendered labels.
 *
 * The simple-mode copy lint and the state-mapping parity gate live in
 * simple-foundations.test.ts / simple-copy-lint (same CI suite); the action
 * menu's enabled-set snapshots live in IssueDrawer.test.tsx and the
 * issue-actions-* parity tests.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..');

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

const FILES = [...walk(SRC)];
const rel = (file: string) => relative(SRC, file).replace(/\\/g, '/');
const SELF = rel(__filename);
const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);

/**
 * Production (non-test) files whose source has an import/export-from edge to
 * `pathSpec` (matched against the module path in a `from '…'` clause — robust
 * to multi-line imports; comments don't write `from '…'` clauses).
 */
function importersOf(pathSpec: RegExp): string[] {
  const fromRe = new RegExp(`\\bfrom\\s+['"][^'"]*${pathSpec.source}['"]`);
  const out: string[] = [];
  for (const file of FILES) {
    if (isTest(file)) continue;
    if (fromRe.test(readFileSync(file, 'utf8'))) out.push(rel(file));
  }
  return out.sort();
}

describe('conformance gate: single shell (C-DETAIL §3.9)', () => {
  it('DrawerAgentSession has only the two sanctioned consumers', () => {
    // PAN-3090: the simple issue page deliberately left this list — it renders
    // its own narrative feed (SimpleActivityFeed) instead of the operator
    // transcript. Only advanced-mode surfaces mount DrawerAgentSession now.
    expect(importersOf(/drawer\/DrawerAgentSession/)).toEqual([
      'components/dock/ConversationDock.tsx',
      'components/issue-detail/IssueDetail.tsx',
    ]);
  });

  it('SimpleActivityFeed is only composed by the simple issue page', () => {
    // PAN-3090: one narrative-feed consumer, same no-fork discipline as the
    // shell gate above — a second simple surface must share, not copy.
    expect(importersOf(/SimpleActivityFeed/)).toEqual([
      'components/simple/SimpleIssuePage.tsx',
    ]);
  });

  it('IssueDetailShell is only composed by IssueDetail itself', () => {
    // Every surface reaches the shell through the ONE component (#2962).
    expect(importersOf(/IssueDetailShell/)).toEqual([
      'components/issue-detail/IssueDetail.tsx',
    ]);
  });

  it('only the sanctioned shells host IssueDetail', () => {
    // The drawer frame, and the cockpit route at page density (#2962
    // decision 2). The deck tree's rail-density mount was rejected by the
    // operator (2026-07-20) — no IssueDetail in the tree.
    expect(importersOf(/issue-detail\/IssueDetail/)).toEqual([
      'components/Stage/cockpit/IssueMissionControl.tsx',
      'components/drawer/IssueDrawer.tsx',
    ]);
  });

  it('the replaced DrawerTabs component stays deleted', () => {
    expect(existsSync(join(SRC, 'components/drawer/DrawerTabs.tsx'))).toBe(false);
  });
});

describe('conformance gate: single menu skin (C-ACTIONS §3.9)', () => {
  it('the grouped body only renders inside the IssueActionMenu skin', () => {
    expect(importersOf(/IssueActionGroupedBody/)).toEqual([
      'components/IssueActionMenu/IssueActionMenu.tsx',
      'components/IssueActionMenu/index.ts',
    ]);
  });

  it('the deleted menu skins (IssueActionMegaMenu, IssueAgentCard) stay deleted', () => {
    const offenders = FILES.filter((file) =>
      rel(file) !== SELF && /IssueActionMegaMenu|IssueAgentCard/.test(readFileSync(file, 'utf8')),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('conformance gate: one phase vocabulary (C-VOCAB §3.9)', () => {
  // Quoted literals in PRODUCTION source only — comments may reference
  // history, and test fixtures may seed legacy-shaped data. WorkspaceStatusCard's
  // 'Building' is a workspace build status (a different domain), allowlisted.
  const LEGACY_LABEL = /['"`](Triaged|Implemented|Reviewed|Building|Reviewing)['"`]/;
  const ALLOWLIST = new Set(['components/CommandDeck/WorkspaceStatusCard.tsx']);

  it('legacy phase label sets never re-enter the tree', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (isTest(file) || rel(file) === SELF || ALLOWLIST.has(rel(file))) continue;
      const text = readFileSync(file, 'utf8');
      if (LEGACY_LABEL.test(text)) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });

  it('the six-word PHASES enum is the single phase source', () => {
    expect(existsSync(join(SRC, 'lib/simple/phases.ts'))).toBe(true);
    const text = readFileSync(join(SRC, 'lib/simple/phases.ts'), 'utf8');
    for (const phase of ["'plan'", "'work'", "'review'", "'test'", "'ship'", "'done'"]) {
      expect(text).toContain(phase);
    }
  });
});

describe('conformance gate: a truncating button carries its own width', () => {
  // A <button> is intrinsically sized: even at `display: block` it shrinks to
  // its text instead of filling the parent, so `truncate` clips at the text's
  // own width and the label paints straight over its neighbours. The parent's
  // `min-w-0 flex-1` cannot save it — the button needs `w-full`/`max-w-*`.
  // This is the PAN-2908 "Just filed" overflow: titles ran under the buttons.
  const BUTTON_TAG = /<button\b[\s\S]{0,400}?>/g;

  it('no <button> truncates without an explicit width', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (isTest(file) || rel(file) === SELF || !file.endsWith('.tsx')) continue;
      const text = readFileSync(file, 'utf8');
      for (const [tag] of text.matchAll(BUTTON_TAG)) {
        if (/\btruncate\b/.test(tag) && !/\bw-full\b|\bmax-w-/.test(tag)) {
          offenders.push(`${rel(file)}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
