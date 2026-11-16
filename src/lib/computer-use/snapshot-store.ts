/**
 * Caches snapshot element records per holder/app and saves screenshots as PNG
 * files (PAN-5452, PRD 3e). Indexes always refer to the most recent tree
 * printed for that app — saveSnapshot always overwrites the cache entry.
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ComputerUseError } from './errors.js';
import { screenshotDir, snapshotDir } from './paths.js';

export interface ElementRecord extends Record<string, unknown> {
  index: number;
}

export interface SnapshotToStore {
  snapshotId: string;
  windowIndex?: number | null;
  elements: ElementRecord[];
}

interface StoredSnapshot {
  snapshotId: string;
  app: string;
  windowIndex: number | null;
  elements: ElementRecord[];
}

export interface SnapshotStoreDeps {
  snapshotDir?: (holderKey: string) => string;
  screenshotDir?: () => string;
  mkdir?: typeof mkdir;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  readdir?: typeof readdir;
  stat?: typeof stat;
  rm?: typeof rm;
}

/** `--app` value, sanitized for use as a filename (mirrors lease.ts's holderKey). */
function sanitizeAppKey(appQuery: string): string {
  return appQuery.replace(/[^A-Za-z0-9._-]/g, '_');
}

function snapshotFilePath(holderKey: string, appQuery: string, deps: SnapshotStoreDeps): string {
  const dir = (deps.snapshotDir ?? snapshotDir)(holderKey);
  return join(dir, `${sanitizeAppKey(appQuery)}.json`);
}

export async function saveSnapshot(
  holderKey: string,
  appQuery: string,
  response: SnapshotToStore,
  deps: SnapshotStoreDeps = {},
): Promise<void> {
  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  const dir = (deps.snapshotDir ?? snapshotDir)(holderKey);
  await mkdirFn(dir, { recursive: true, mode: 0o700 });
  const stored: StoredSnapshot = {
    snapshotId: response.snapshotId,
    app: appQuery,
    windowIndex: response.windowIndex ?? null,
    elements: response.elements,
  };
  await writeFileFn(snapshotFilePath(holderKey, appQuery, deps), JSON.stringify(stored));
}

export async function elementRecord(
  holderKey: string,
  appQuery: string,
  index: number,
  deps: SnapshotStoreDeps = {},
): Promise<ElementRecord> {
  const readFileFn = deps.readFile ?? readFile;
  const notFound = new ComputerUseError(
    'element_not_found',
    `Element ${index} is not in the latest ${appQuery} snapshot. Run pan computer get-app-state --app ${appQuery} and use a fresh index.`,
  );

  let stored: StoredSnapshot;
  try {
    stored = JSON.parse(await readFileFn(snapshotFilePath(holderKey, appQuery, deps), 'utf-8')) as StoredSnapshot;
  } catch {
    throw notFound;
  }
  const record = stored.elements.find((element) => element.index === index);
  if (!record) throw notFound;
  return record;
}

const MAX_SCREENSHOTS = 50;

export interface SavedScreenshot {
  path: string;
  width: number | null;
  height: number | null;
  scale: number | null;
}

export interface ScreenshotSnapshot {
  snapshotId: string;
  screenshotPngBase64?: string | null;
  screenshotWidth?: number | null;
  screenshotHeight?: number | null;
  screenshotScale?: number | null;
}

/** Writes `screenshots/<snapshotId>.png` and prunes to the 50 newest. Never exposes the base64. */
export async function saveScreenshot(
  snapshot: ScreenshotSnapshot,
  deps: SnapshotStoreDeps = {},
): Promise<SavedScreenshot | null> {
  if (!snapshot.screenshotPngBase64) return null;

  const mkdirFn = deps.mkdir ?? mkdir;
  const writeFileFn = deps.writeFile ?? writeFile;
  const dir = (deps.screenshotDir ?? screenshotDir)();
  await mkdirFn(dir, { recursive: true, mode: 0o700 });

  const path = join(dir, `${snapshot.snapshotId}.png`);
  await writeFileFn(path, Buffer.from(snapshot.screenshotPngBase64, 'base64'));
  await pruneOldScreenshots(dir, deps);

  return {
    path,
    width: snapshot.screenshotWidth ?? null,
    height: snapshot.screenshotHeight ?? null,
    scale: snapshot.screenshotScale ?? null,
  };
}

async function pruneOldScreenshots(dir: string, deps: SnapshotStoreDeps): Promise<void> {
  const readdirFn = deps.readdir ?? readdir;
  const statFn = deps.stat ?? stat;
  const rmFn = deps.rm ?? rm;

  const names = (await readdirFn(dir)).filter((name) => name.endsWith('.png'));
  if (names.length <= MAX_SCREENSHOTS) return;

  const withMtimes = await Promise.all(
    names.map(async (name) => ({ name, mtimeMs: (await statFn(join(dir, name))).mtimeMs })),
  );
  withMtimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  await Promise.all(withMtimes.slice(MAX_SCREENSHOTS).map((entry) => rmFn(join(dir, entry.name), { force: true })));
}
