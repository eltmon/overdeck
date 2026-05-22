/**
 * Layer rendering (PAN-1201).
 *
 * Turns canonical layer markdown into the content `pan sync` writes to a
 * harness's home. The global and project layers are written into a *managed
 * region* of the target CLAUDE.md (delimited by HTML comment markers) so any
 * hand-authored content in that file is preserved across syncs.
 */

import type { Harness } from '@panctl/contracts';
import { renderForHarness } from './harness.js';
import { renderBundledRules } from './rules.js';
import { globalContextFile, projectContextFile, readLayerContent } from './layers.js';

/** Opening marker of the Panopticon-managed region in a target CLAUDE.md. */
export const REGION_BEGIN =
  '<!-- BEGIN PANOPTICON CONTEXT — managed by `pan sync`; edit the layer source, not this region -->';

/** Closing marker of the Panopticon-managed region. */
export const REGION_END = '<!-- END PANOPTICON CONTEXT -->';

/**
 * Insert or replace the Panopticon-managed region inside an existing file.
 *
 * Content outside the markers is preserved untouched. When the file has no
 * region yet, one is appended (after existing content, if any). This keeps a
 * user's own ~/.claude/CLAUDE.md content safe — `pan sync` only ever owns the
 * span between the markers.
 */
export function applyManagedRegion(existing: string, managed: string): string {
  const region = `${REGION_BEGIN}\n${managed.trim()}\n${REGION_END}`;
  const beginIdx = existing.indexOf(REGION_BEGIN);
  const endIdx = existing.indexOf(REGION_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + REGION_END.length);
    return `${before}${region}${after}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  const trimmed = existing.trim();
  return (trimmed ? `${trimmed}\n\n${region}` : region) + '\n';
}

/**
 * Render the global layer for one harness: `global.md` rendered, with the
 * applicable bundled engineering rules folded in below it.
 *
 * The result is the *managed content* — caller wraps it via
 * {@link applyManagedRegion} when writing the harness's CLAUDE.md.
 */
export function renderGlobalLayer(harness: Harness, includeDevRules: boolean): string {
  const layer = renderForHarness(readLayerContent(globalContextFile()), harness).trim();
  const rules = renderBundledRules(harness, includeDevRules);
  return [layer, rules].filter((s) => s.length > 0).join('\n\n---\n\n');
}

/**
 * Render a project layer for one harness. Returns '' when the project has no
 * `project.md` — sync then leaves that project's CLAUDE.md alone.
 */
export function renderProjectLayer(projectRoot: string, harness: Harness): string {
  const raw = readLayerContent(projectContextFile(projectRoot));
  if (raw.trim().length === 0) return '';
  return renderForHarness(raw, harness).trim();
}
