/**
 * Write door for the color theme selection (PAN-4644): only `ui.color_theme.<mode>`
 * is edited with `setIn` — every other node in config.yaml (comments, unrelated
 * top-level keys) keeps its text untouched. Mirrors `src/lib/jev/settings.ts`.
 */
import { readFile } from 'node:fs/promises';
import { isMap, parseDocument, type Document } from 'yaml';
import type { ColorThemeType } from '@overdeck/contracts';
import { clearConfigCache, getGlobalConfigPath } from '../config-yaml/load.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { runSettingsWriteSerialized } from '../settings-api.js';

/**
 * `setIn` throws `Expected YAML collection at <path>` when an existing node
 * on the path is present but not a map (e.g. `ui:` or `ui.color_theme:`
 * parses as a null scalar, or either holds a plain string). Replace such a
 * node with an empty map first, so a hand-written `ui:\n  color_theme:\n`
 * (or any other non-map value) never 500s the save.
 */
function ensureMapAt(doc: Document, path: readonly string[]): void {
  const existing = doc.getIn(path);
  if (existing !== undefined && !isMap(existing)) {
    // `setIn` with a bare `{}` stores the raw JS object as-is rather than
    // wrapping it into a YAMLMap node, which still fails the next `setIn`'s
    // "Expected YAML collection" check — createNode() builds a real node.
    doc.setIn(path, doc.createNode({}));
  }
}

/** Validates and persists the selected theme id for one mode, inside the serialized write queue. */
export function saveColorThemeSelection(mode: ColorThemeType, id: string): Promise<void> {
  const path = getGlobalConfigPath();
  return runSettingsWriteSerialized(async () => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      text = '';
    }
    const doc = parseDocument(text);
    ensureMapAt(doc, ['ui']);
    ensureMapAt(doc, ['ui', 'color_theme']);
    doc.setIn(['ui', 'color_theme', mode], id);
    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
  });
}
