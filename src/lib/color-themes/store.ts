import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import {
  BUILTIN_COLOR_THEMES,
  COLOR_THEME_ID_RE,
  RESERVED_COLOR_THEME_IDS,
  normalizeColorTheme,
  slugifyThemeId,
  type ColorTheme,
} from '@overdeck/contracts';
import { getOverdeckHome } from '../paths.js';
import { writeFileAtomic } from '../model-presets/state.js';

export function getColorThemesDir(): string {
  return join(getOverdeckHome(), 'themes');
}

function themeFilePath(id: string): string {
  return join(getColorThemesDir(), `${id}.json`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Reads the themes directory fresh on every call — built-ins first, then user themes sorted by id. */
export async function listColorThemes(): Promise<{ themes: ColorTheme[]; warnings: string[] }> {
  const themes: ColorTheme[] = [...Object.values(BUILTIN_COLOR_THEMES)];
  const warnings: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(getColorThemesDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { themes, warnings };
    throw err;
  }

  const ids = entries
    .filter(name => name.toLowerCase().endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));

  for (const id of ids) {
    if (!COLOR_THEME_ID_RE.test(id)) {
      warnings.push(`${id}.json: invalid theme id; skipping`);
      continue;
    }
    let raw: unknown;
    try {
      const text = await readFile(themeFilePath(id), 'utf8');
      raw = JSON.parse(text);
    } catch (err) {
      warnings.push(`${id}.json: ${err instanceof Error ? err.message : String(err)}; skipping`);
      continue;
    }
    const result = normalizeColorTheme(raw, id);
    if ('errors' in result) {
      warnings.push(`${id}.json: ${result.errors.join('; ')}; skipping`);
      continue;
    }
    for (const warning of result.warnings) warnings.push(`${id}.json: ${warning}`);
    themes.push(result.theme);
  }

  return { themes, warnings };
}

export async function getColorTheme(id: string): Promise<ColorTheme | undefined> {
  const builtin = (BUILTIN_COLOR_THEMES as Record<string, ColorTheme>)[id];
  if (builtin !== undefined) return builtin;

  if (!COLOR_THEME_ID_RE.test(id)) return undefined;

  let raw: unknown;
  try {
    const text = await readFile(themeFilePath(id), 'utf8');
    raw = JSON.parse(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }

  const result = normalizeColorTheme(raw, id);
  if ('errors' in result) return undefined;
  return result.theme;
}

async function nextAvailableId(baseId: string): Promise<string> {
  let candidate = baseId;
  let suffix = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!RESERVED_COLOR_THEME_IDS.includes(candidate) && !(await fileExists(themeFilePath(candidate)))) {
      return candidate;
    }
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
}

/**
 * Normalizes and persists a raw theme as `<id>.json`, never overwriting an
 * existing file or a reserved built-in id. The id is the file name — it is
 * not stored inside the file.
 */
export async function saveColorTheme(
  file: unknown,
  opts: { preferredId?: string } = {},
): Promise<{ theme: ColorTheme; warnings: string[] } | { errors: string[] }> {
  const probe = normalizeColorTheme(file, 'probe');
  if ('errors' in probe) return probe;

  const baseId = opts.preferredId ?? slugifyThemeId(probe.theme.name);
  const id = await nextAvailableId(baseId);

  const result = normalizeColorTheme(file, id);
  if ('errors' in result) return result;

  const { id: _id, builtin: _builtin, ...fileContents } = result.theme;
  await writeFileAtomic(themeFilePath(id), `${JSON.stringify(fileContents, null, 2)}\n`, 0o644);

  return result;
}
