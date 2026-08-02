/**
 * Layer rendering (PAN-1201).
 *
 * Turns canonical layer markdown into the content `pan sync` writes to a
 * harness's home. The global and project layers are written into a *managed
 * region* of the target CLAUDE.md (delimited by HTML comment markers) so any
 * hand-authored content in that file is preserved across syncs.
 */

import type { Harness } from '@overdeck/contracts';
import { renderForHarness } from './harness.js';
import { renderBundledRules } from './rules.js';
import { globalContextFile, resolveProjectContextFile, readLayerContent } from './layers.js';

/** Opening marker of the Overdeck-managed region in a target CLAUDE.md. */
export const REGION_BEGIN =
  '<!-- BEGIN OVERDECK CONTEXT — managed by `pan sync`; edit the layer source, not this region -->';

/** Closing marker of the Overdeck-managed region. */
export const REGION_END = '<!-- END OVERDECK CONTEXT -->';

const BEADS_REGION = /<!-- BEGIN BEADS INTEGRATION\b[\s\S]*?<!-- END BEADS INTEGRATION -->\s*/g;

/** Pre-rebrand managed region — superseded by the OVERDECK markers, never rewritten since. */
const LEGACY_PANOPTICON_REGION = /<!-- BEGIN PANOPTICON CONTEXT\b[\s\S]*?<!-- END PANOPTICON CONTEXT -->\s*/g;

/** Headings of sections `bd onboard` writes outside its marked region. */
const BD_ONBOARD_SECTIONS = /^## (Quick Reference|Landing the Plane \(Session Completion\)|Session Completion)\s*$/;

/** bd CLI invocations that prove a section is bd-onboard boilerplate, not user prose. */
const BD_COMMAND = /\bbd (ready|show|update|close|sync|prime|onboard|dolt)\b/;

/**
 * Remove the sections `bd onboard` wrote *without* markers: the
 * "This project uses **bd** (beads)" intro (plus its architecture blockquote)
 * and the Quick Reference / session-completion sections. Older bd versions
 * wrote these as plain markdown, so the marked-region strip never sees them
 * (PAN-2648 removed only the marked block). A section is dropped only when its
 * body actually invokes `bd`, so user prose that merely mentions beads —
 * e.g. the deep-wipe rule's legacy `.beads/` note — is untouched.
 */
function stripBeadsOnboardBoilerplate(existing: string): string {
  const lines = existing.split('\n');
  const kept: string[] = [];
  let removed = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Intro paragraph + optional architecture blockquote that follows it.
    if (line.startsWith('This project uses **bd') && line.includes('(beads)')) {
      i++;
      while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('>'))) i++;
      removed = true;
      continue;
    }
    // bd-onboard section: heading through the line before the next heading/marker.
    if (BD_ONBOARD_SECTIONS.test(line)) {
      let end = i + 1;
      while (end < lines.length && !/^#{1,2} /.test(lines[end]) && !lines[end].startsWith('<!--')) end++;
      if (BD_COMMAND.test(lines.slice(i + 1, end).join('\n'))) {
        i = end;
        removed = true;
        continue;
      }
    }
    kept.push(line);
    i++;
  }
  if (!removed) return existing;
  let cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  // bd onboard's file header — drop it when nothing else remains.
  if (cleaned.trim() === '# Agent Instructions') cleaned = '';
  return cleaned;
}

/**
 * Remove bd's generic agent-policy block before Overdeck renders its canonical
 * project context. The Beads block's conservative/minimal profiles forbid the
 * commit and push operations that managed work agents must perform per bead.
 * The marked region is owned unambiguously; unmarked bd-onboard boilerplate is
 * recognized by its verbatim intro/section shapes. Hand-authored content remains.
 */
export function stripBeadsManagedRegion(existing: string): string {
  let cleaned = existing;
  if (cleaned.includes('<!-- BEGIN BEADS INTEGRATION')) {
    cleaned = cleaned.replace(BEADS_REGION, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  if (cleaned.includes('This project uses **bd') || BD_COMMAND.test(cleaned)) {
    cleaned = stripBeadsOnboardBoilerplate(cleaned);
  }
  return cleaned;
}

/**
 * Insert or replace the Overdeck-managed region inside an existing file.
 *
 * Content outside the markers is preserved untouched. When the file has no
 * region yet, one is appended (after existing content, if any). This keeps a
 * user's own ~/.claude/CLAUDE.md content safe — `pan sync` only ever owns the
 * span between the markers.
 */
export function applyManagedRegion(existing: string, managed: string): string {
  existing = stripBeadsManagedRegion(existing);
  // Rebrand leftover: a PANOPTICON-marked region is this same managed region
  // under its old name — orphaned when the markers were renamed, so it would
  // otherwise persist as a stale duplicate next to the OVERDECK one forever.
  if (existing.includes('<!-- BEGIN PANOPTICON CONTEXT')) {
    existing = existing.replace(LEGACY_PANOPTICON_REGION, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  const region = `${REGION_BEGIN}\n${managed.trim()}\n${REGION_END}`;
  const beginIdx = existing.indexOf(REGION_BEGIN);
  // Use the LAST end-marker, not the first. Layer content may legitimately
  // contain the literal string `<!-- END OVERDECK CONTEXT -->` in prose (e.g.
  // global.md documents the markers). With `indexOf`, that inner mention is
  // mistaken for the region terminator, so everything after it — including any
  // previously-rendered copies — survives as "outside" content and a fresh copy
  // is prepended on every sync. That grew CLAUDE.md by one full copy of the
  // managed region per `pan sync` (observed: 19× / ~300KB). The real terminator
  // is always appended last, so `lastIndexOf` lands on it — and this splice
  // self-heals an already-bloated file in a single sync.
  const endIdx = existing.lastIndexOf(REGION_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + REGION_END.length);
    return `${before}${region}${after}`.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  const trimmed = existing.trim();
  return (trimmed ? `${trimmed}\n\n${region}` : region) + '\n';
}

/** True when `existing` already contains a Overdeck-managed region. */
export function hasManagedRegion(existing: string): boolean {
  const beginIdx = existing.indexOf(REGION_BEGIN);
  const endIdx = existing.indexOf(REGION_END);
  return beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx;
}

/**
 * Return `existing` with the Overdeck-managed region removed — i.e. only the
 * hand-authored content the user owns, trimmed. When there is no region, the
 * whole (trimmed) file is the user's. Used to decide whether a target file has
 * pre-existing content worth preserving and backing up before first injection.
 */
export function userContentOutsideRegion(existing: string): string {
  const beginIdx = existing.indexOf(REGION_BEGIN);
  // lastIndexOf for the same reason as applyManagedRegion: the managed content
  // can contain a literal end-marker in prose; the true terminator is last.
  const endIdx = existing.lastIndexOf(REGION_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    return (existing.slice(0, beginIdx) + existing.slice(endIdx + REGION_END.length)).trim();
  }
  return existing.trim();
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
 * Render a project layer for one harness, or a union of harnesses sharing
 * one physical target file. Returns '' when the project has no
 * `project.md` — sync then leaves that project's CLAUDE.md/AGENTS.md alone.
 */
export function renderProjectLayer(projectRoot: string, harness: Harness | readonly Harness[]): string {
  const raw = readLayerContent(resolveProjectContextFile(projectRoot));
  if (raw.trim().length === 0) return '';
  return renderForHarness(raw, harness).trim();
}
