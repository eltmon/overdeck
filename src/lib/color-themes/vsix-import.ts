/**
 * Maps every color theme a VS Code extension package (.vsix) contributes
 * (PAN-4659). The archive is read in memory by `zip-reader.ts`; nothing is
 * written. Package-level failures throw `ColorThemeImportError`; a failure
 * inside one contributed theme's file chain drops only that theme with a
 * warning prefixed by its label or path.
 */
import { posix } from 'node:path';
import type { ColorTheme, ColorThemeType } from '@overdeck/contracts';
import { ColorThemeImportError, isPlainObject, mapVsCodeThemeObject, parseVsCodeThemeText } from './vscode-import.js';
import { readZipDirectory, readZipEntry, ZipFormatError, type ZipEntry } from './zip-reader.js';

export const MAX_VSIX_BYTES = 10 * 1024 * 1024;
export const MAX_VSIX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_VSIX_THEMES = 20;
export const MAX_INCLUDE_DEPTH = 5;

const EXTENSION_DIR = 'extension/';
const PACKAGE_JSON = 'extension/package.json';
const PACKAGE_NLS_JSON = 'extension/package.nls.json';
const NLS_PLACEHOLDER = /^%(.+)%$/;
const THEME_FILE = /\.jsonc?$/i;

const UI_THEME_TYPES: Record<string, ColorThemeType> = {
  vs: 'light',
  'hc-light': 'light',
  'vs-dark': 'dark',
  'hc-black': 'dark',
};

/** A path inside the archive, shown relative to `extension/`. */
function display(entryPath: string): string {
  return entryPath.startsWith(EXTENSION_DIR) ? entryPath.slice(EXTENSION_DIR.length) : entryPath;
}

/** Resolves an archive path; returns undefined when it leaves `extension/` or is not a .json/.jsonc file. */
function resolveThemePath(fromDir: string, relative: string): string | undefined {
  const resolved = posix.normalize(posix.join(fromDir, relative));
  if (!resolved.startsWith(EXTENSION_DIR) || resolved.split('/').includes('..') || !THEME_FILE.test(resolved)) {
    return undefined;
  }
  return resolved;
}

interface VsixReader {
  archive: Buffer;
  directory: Map<string, ZipEntry>;
}

async function readThemeFile(reader: VsixReader, entryPath: string): Promise<Record<string, unknown>> {
  const entry = reader.directory.get(entryPath);
  if (!entry) {
    throw new ColorThemeImportError(`"${display(entryPath)}" not found in the package`);
  }
  const bytes = await readZipEntry(reader.archive, entry, MAX_VSIX_FILE_BYTES);
  try {
    return parseVsCodeThemeText(bytes.toString('utf8'));
  } catch (err) {
    if (err instanceof ColorThemeImportError) {
      throw new ColorThemeImportError(`${display(entryPath)}: ${err.message}`);
    }
    throw err;
  }
}

/** Loads a theme file and its include chain, merged: included colors underneath, included token rules first. */
async function loadMerged(
  reader: VsixReader,
  entryPath: string,
  chain: string[],
  warnings: string[],
): Promise<Record<string, unknown>> {
  if (chain.includes(entryPath)) {
    throw new ColorThemeImportError(`include cycle: ${[...chain, entryPath].map(display).join(' → ')}`);
  }
  if (chain.length > MAX_INCLUDE_DEPTH) {
    throw new ColorThemeImportError(`include depth exceeds ${MAX_INCLUDE_DEPTH}`);
  }
  const own = await readThemeFile(reader, entryPath);

  let ownTokenColors: unknown[] = [];
  if (typeof own.tokenColors === 'string') {
    warnings.push(`tokenColors in ${display(entryPath)} points to a .tmTheme file (${own.tokenColors}); its syntax rules are skipped`);
  } else if (Array.isArray(own.tokenColors)) {
    ownTokenColors = own.tokenColors;
  }

  let base: Record<string, unknown> = { colors: {}, tokenColors: [] };
  if (typeof own.include === 'string') {
    const includePath = resolveThemePath(posix.dirname(entryPath), own.include);
    if (includePath === undefined) {
      throw new ColorThemeImportError(
        `include "${own.include}" in ${display(entryPath)} resolves outside extension/ or is not a .json file`,
      );
    }
    base = await loadMerged(reader, includePath, [...chain, entryPath], warnings);
  } else if (own.include !== undefined) {
    warnings.push(`include in ${display(entryPath)} is not a string; ignored`);
  }

  const merged: Record<string, unknown> = {
    ...base,
    ...own,
    colors: { ...(isPlainObject(base.colors) ? base.colors : {}), ...(isPlainObject(own.colors) ? own.colors : {}) },
    tokenColors: [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...ownTokenColors],
  };
  if (own.name === undefined) delete merged.name;
  delete merged.include;
  return merged;
}

async function readNlsLabels(reader: VsixReader, warnings: string[]): Promise<Record<string, unknown> | undefined> {
  const entry = reader.directory.get(PACKAGE_NLS_JSON);
  if (!entry) return undefined;
  try {
    const bytes = await readZipEntry(reader.archive, entry, MAX_VSIX_FILE_BYTES);
    return parseVsCodeThemeText(bytes.toString('utf8'));
  } catch (err) {
    if (err instanceof ColorThemeImportError || err instanceof ZipFormatError) {
      warnings.push(`package.nls.json: ${err.message}; labels left unresolved`);
      return undefined;
    }
    throw err;
  }
}

function resolveLabel(label: unknown, nls: Record<string, unknown> | undefined): string | undefined {
  if (typeof label !== 'string' || !label.trim()) return undefined;
  const placeholder = NLS_PLACEHOLDER.exec(label);
  if (!placeholder) return label;
  const value = nls?.[placeholder[1]!];
  if (typeof value === 'string' && value.trim()) return value;
  if (isPlainObject(value) && typeof value.message === 'string' && value.message.trim()) return value.message;
  return undefined;
}

/** Maps every theme in a .vsix's contributes.themes (PAN-4659). Throws ColorThemeImportError for package-level failures; theme-level failures become prefixed warnings. Writes nothing. */
export async function importVsixThemes(
  archive: Buffer,
  vsixFileName: string,
): Promise<{ themes: ColorTheme[]; warnings: string[] }> {
  if (archive.byteLength > MAX_VSIX_BYTES) {
    throw new ColorThemeImportError(
      `archive is ${(archive.byteLength / 1048576).toFixed(1)} MB; the .vsix import limit is 10 MB`,
    );
  }

  let reader: VsixReader;
  let manifestBytes: Buffer;
  try {
    reader = { archive, directory: readZipDirectory(archive) };
    const manifestEntry = reader.directory.get(PACKAGE_JSON);
    if (!manifestEntry) {
      throw new ColorThemeImportError(`${PACKAGE_JSON} not found; is this a VS Code extension package?`);
    }
    manifestBytes = await readZipEntry(archive, manifestEntry, MAX_VSIX_FILE_BYTES);
  } catch (err) {
    if (err instanceof ZipFormatError) throw new ColorThemeImportError(`invalid .vsix: ${err.message}`);
    throw err;
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = parseVsCodeThemeText(manifestBytes.toString('utf8'));
  } catch (err) {
    if (err instanceof ColorThemeImportError) throw new ColorThemeImportError(`${PACKAGE_JSON}: ${err.message}`);
    throw err;
  }

  const contributed = isPlainObject(manifest.contributes) ? manifest.contributes.themes : undefined;
  if (!Array.isArray(contributed) || contributed.length === 0) {
    throw new ColorThemeImportError(
      `${PACKAGE_JSON} contributes no color themes (contributes.themes is missing or empty)`,
    );
  }
  if (contributed.length > MAX_VSIX_THEMES) {
    throw new ColorThemeImportError(
      `package contributes ${contributed.length} themes; at most ${MAX_VSIX_THEMES} are supported`,
    );
  }

  const warnings: string[] = [];
  const needsNls = contributed.some((item) => isPlainObject(item) && typeof item.label === 'string' && NLS_PLACEHOLDER.test(item.label));
  const nls = needsNls ? await readNlsLabels(reader, warnings) : undefined;

  const themes: ColorTheme[] = [];
  for (const [index, item] of contributed.entries()) {
    const entry = isPlainObject(item) ? item : {};
    const label = resolveLabel(entry.label, nls);
    const key = label
      ?? (typeof entry.label === 'string' && entry.label ? entry.label : undefined)
      ?? (typeof entry.path === 'string' ? entry.path : `theme ${index + 1}`);
    try {
      if (typeof entry.path !== 'string' || !entry.path) {
        throw new ColorThemeImportError('contributes.themes entry has no path');
      }
      if (!THEME_FILE.test(entry.path)) {
        throw new ColorThemeImportError(`path "${entry.path}" is not a .json theme file (.tmTheme themes are not supported)`);
      }
      const entryPath = resolveThemePath('extension', entry.path);
      if (entryPath === undefined) {
        throw new ColorThemeImportError(`path "${entry.path}" resolves outside extension/`);
      }

      const themeWarnings: string[] = [];
      const type = typeof entry.uiTheme === 'string' ? UI_THEME_TYPES[entry.uiTheme] : undefined;
      if (type === undefined) {
        themeWarnings.push(
          `uiTheme ${entry.uiTheme === undefined ? 'is missing' : `"${String(entry.uiTheme)}" is not recognized`}; type taken from the theme file`,
        );
      }

      const merged = await loadMerged(reader, entryPath, [], themeWarnings);
      const fileName = typeof merged.name === 'string' && merged.name.trim() ? merged.name : undefined;
      merged.name = label ?? fileName ?? posix.basename(entryPath).replace(THEME_FILE, '');
      if (type !== undefined) merged.type = type;

      const { theme, warnings: mapWarnings } = mapVsCodeThemeObject(merged, `${vsixFileName}:${display(entryPath)}`);
      themes.push(theme);
      for (const warning of [...themeWarnings, ...mapWarnings]) warnings.push(`"${theme.name}": ${warning}`);
    } catch (err) {
      if (err instanceof ColorThemeImportError || err instanceof ZipFormatError) {
        warnings.push(`"${key}": ${err.message}; skipped`);
        continue;
      }
      throw err;
    }
  }

  if (themes.length === 0) {
    throw new ColorThemeImportError(`no importable themes in ${vsixFileName}: ${warnings.join('; ')}`);
  }
  return { themes, warnings };
}
