/**
 * Bundled engineering rules (PAN-1201).
 *
 * Panopticon ships a small set of engineering rules under sync-sources/rules/.
 * Each rule carries a `scope:` frontmatter key:
 *
 *   universal — distributed everywhere (relevant to anyone running agents)
 *   dev       — distributed only on a panopticon-cli checkout (rules about
 *               developing Panopticon itself)
 *
 * `pan sync` folds the applicable rules into the rendered global CLAUDE.md.
 * Their `paths:` frontmatter (Claude Code path-scoping) is dropped on fold —
 * a folded rule is always-on.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Harness } from '@panctl/contracts';
import { SYNC_SOURCES } from '../paths.js';
import { renderForHarness } from './harness.js';

/** Where a bundled rule is distributed. */
export type RuleScope = 'universal' | 'dev';

/** A parsed bundled rule. */
export interface BundledRule {
  /** File basename without the `.md` extension. */
  name: string;
  scope: RuleScope;
  /** Markdown body with frontmatter stripped. */
  body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse a rule file into `{ scope, body }`. Rules with no frontmatter, or
 * frontmatter without a recognised `scope:`, default to `universal`.
 */
export function parseRule(name: string, raw: string): BundledRule {
  const m = FRONTMATTER_RE.exec(raw);
  let scope: RuleScope = 'universal';
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    const scopeLine = m[1].split(/\r?\n/).find((l) => /^\s*scope\s*:/.test(l));
    const value = scopeLine?.split(':')[1]?.trim().replace(/['"]/g, '');
    if (value === 'dev' || value === 'universal') scope = value;
  }
  return { name, scope, body: body.trim() };
}

/** Read every bundled rule from sync-sources/rules/, sorted by name. */
export function readBundledRules(): BundledRule[] {
  const dir = SYNC_SOURCES.rules;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseRule(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf-8')));
}

/**
 * Render the applicable bundled rules into one CLAUDE.md section.
 *
 * `includeDev` admits `scope: dev` rules — set it from `isDevMode()` so they
 * only fold in on a panopticon-cli checkout. Each rule body is rendered for
 * the target harness so any `{{#harness:*}}` blocks resolve. Returns '' when
 * no rules apply.
 */
export function renderBundledRules(harness: Harness, includeDev: boolean): string {
  const rules = readBundledRules().filter((r) => includeDev || r.scope === 'universal');
  const sections = rules
    .map((r) => renderForHarness(r.body, harness).trim())
    .filter((s) => s.length > 0);
  if (sections.length === 0) return '';
  return `## Panopticon Engineering Rules\n\n${sections.join('\n\n')}`;
}
