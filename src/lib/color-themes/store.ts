import { randomBytes } from 'crypto';
import { link, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
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

export function getColorThemesDir(): string {
  return join(getOverdeckHome(), 'themes');
}

function themeFilePath(id: string): string {
  return join(getColorThemesDir(), `${id}.json`);
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
  if (Object.hasOwn(BUILTIN_COLOR_THEMES, id)) {
    return (BUILTIN_COLOR_THEMES as Record<string, ColorTheme>)[id];
  }

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

/**
 * Claims an unused id for a new theme file and writes `text` to it in one
 * atomic step. `link()` fails with EEXIST if the target already exists, so
 * probing and writing can't be split into separate check-then-write calls —
 * closing a race where two concurrent saves both see a candidate id as free
 * and the second write silently replaces the first (PAN-4644 review).
 */
async function claimThemeFile(baseId: string, text: string, mode: number): Promise<string> {
  const dir = getColorThemesDir();
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  await writeFile(tempPath, text, { mode });
  try {
    let suffix = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Truncate the base so `<base>-<suffix>` never exceeds the 64-char id cap
      // (COLOR_THEME_ID_RE) — slugifyThemeId alone can produce a 64-char id,
      // which a bare "-2" suffix would push past the limit.
      const suffixText = suffix === 1 ? '' : `-${suffix}`;
      const candidate = suffix === 1 ? baseId : `${baseId.slice(0, 64 - suffixText.length)}${suffixText}`;
      if (!RESERVED_COLOR_THEME_IDS.includes(candidate)) {
        try {
          await link(tempPath, themeFilePath(candidate));
          return candidate;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
      }
      suffix += 1;
    }
  } finally {
    await rm(tempPath, { force: true });
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
  const { id: _id, builtin: _builtin, ...fileContents } = probe.theme;
  const text = `${JSON.stringify(fileContents, null, 2)}\n`;

  const id = await claimThemeFile(baseId, text, 0o644);

  return { theme: { ...probe.theme, id }, warnings: probe.warnings };
}
