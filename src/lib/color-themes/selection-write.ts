/**
 * Write door for the color theme selection (PAN-4644): only `ui.color_theme.<mode>`
 * is edited with `setIn` — every other node in config.yaml (comments, unrelated
 * top-level keys) keeps its text untouched. Mirrors `src/lib/jev/settings.ts`.
 */
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';
import type { ColorThemeType } from '@overdeck/contracts';
import { clearConfigCache, getGlobalConfigPath } from '../config-yaml/load.js';
import { writeFileAtomic } from '../model-presets/state.js';
import { runSettingsWriteSerialized } from '../settings-api.js';

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
    doc.setIn(['ui', 'color_theme', mode], id);
    await writeFileAtomic(path, doc.toString({ lineWidth: 120 }), 0o600);
    clearConfigCache();
  });
}
