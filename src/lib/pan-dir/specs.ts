import { join } from 'path'
import { Effect, FileSystem } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { FsError } from '../errors.js'

import { VBriefMergeConflictError } from '../vbrief/io.js'
import { generateVBriefFilename, parseVBriefFilename, slugify } from '../vbrief/lifecycle.js'
import { invalidateVBriefIndex } from '../vbrief/vbrief-index.js'
import type { VBriefDocument } from '../vbrief/types.js'
import { deriveProjectRoot, queueAutoCommit } from './auto-commit.js'
import {
  PAN_DIRNAME,
  PAN_CONTINUES_DIRNAME,
  PAN_DRAFTS_DIRNAME,
  PAN_SPECS_DIRNAME,
  type PanSpecDocument,
  type PanSpecEntry,
  type PanSpecListOptions,
  type PanSpecStatus,
  isPanSpecStatus,
  asPanSpecDocument,
  type ProjectPanPaths,
} from './types.js'

function projectPanPaths(projectRoot: string): ProjectPanPaths {
  return {
    panDir: join(projectRoot, PAN_DIRNAME),
    specsDir: join(projectRoot, PAN_DIRNAME, PAN_SPECS_DIRNAME),
    draftsDir: join(projectRoot, PAN_DIRNAME, PAN_DRAFTS_DIRNAME),
    continuesDir: join(projectRoot, PAN_DIRNAME, PAN_CONTINUES_DIRNAME),
  }
}

export function getProjectPanPaths(projectRoot: string): ProjectPanPaths {
  return projectPanPaths(projectRoot)
}

export function ensurePanDirs(
  projectRoot: string,
): Effect.Effect<ProjectPanPaths, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const paths = projectPanPaths(projectRoot)
    for (const dir of [paths.panDir, paths.specsDir, paths.draftsDir, paths.continuesDir]) {
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.mapError((cause) => new FsError({ path: dir, operation: 'makeDirectory', cause })),
      )
    }
    return paths
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

function mapVBriefPlanStatusToPanSpec(status: unknown): PanSpecStatus | null {
  if (isPanSpecStatus(status)) return status
  if (typeof status !== 'string') return null
  switch (status) {
    case 'approved':
    case 'draft':
    case 'pending':
    case 'blocked':
      return 'proposed'
    case 'running':
      return 'active'
    default:
      return null
  }
}

function parsePanSpecDocumentFromString(raw: string, path: string): PanSpecDocument {
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(path)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid JSON in pan spec ${path}: ${(error as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid pan spec format in ${path}: document is not an object`)
  }

  const doc = parsed as Record<string, unknown>
  // Auto-recover legacy shape: older specs only carry plan.status, not a
  // top-level status. A single legacy file blocked feedback delivery for
  // every issue in the project (PAN-1015 spec on main → review feedback
  // for PAN-977 silently dropped). Derive root status from plan.status
  // when missing rather than throwing.
  // Also map vBRIEF legacy statuses (approved, running) → active.
  if (!isPanSpecStatus(doc.status)) {
    const plan = doc.plan as Record<string, unknown> | undefined
    const mapped = mapVBriefPlanStatusToPanSpec(plan?.status)
    if (mapped) {
      doc.status = mapped
    } else {
      throw new Error(`Invalid pan spec format in ${path}: missing valid root status`)
    }
  }

  // Validate required vBRIEF shape
  if (!doc.vBRIEFInfo || !doc.plan) {
    throw new Error(
      `Invalid vBRIEF format in ${path}: missing 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
        `vBRIEF v0.5 requires exactly { "vBRIEFInfo": { "version": "0.5" }, "plan": { ... } }. ` +
        `See docs/VBRIEF.md for the correct format.`,
    )
  }

  return doc as unknown as PanSpecDocument
}

export function readSpec(path: string): Effect.Effect<PanSpecDocument, FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const raw = yield* fs.readFileString(path, 'utf-8').pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'readFileString', cause })),
    )
    return yield* Effect.try({
      try: () => parsePanSpecDocumentFromString(raw, path),
      catch: (cause) => new FsError({ path, operation: 'parse', cause }),
    })
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function writeSpec(
  path: string,
  doc: PanSpecDocument,
): Effect.Effect<void, FsError> {
  return Effect.gen(function* () {
    if (!isPanSpecStatus(doc.status)) {
      return yield* Effect.fail(
        new FsError({
          path,
          operation: 'writeSpec',
          cause: new Error(`Invalid pan spec status for ${path}: ${String(doc.status)}`),
        }),
      )
    }
    const fs = yield* FileSystem.FileSystem
    const tmp = `${path}.tmp`
    yield* fs.writeFileString(tmp, JSON.stringify(doc, null, 2)).pipe(
      Effect.mapError((cause) => new FsError({ path: tmp, operation: 'writeFileString', cause })),
    )
    yield* fs.rename(tmp, path).pipe(
      Effect.mapError((cause) => new FsError({ path, operation: 'rename', cause })),
    )

    const projectRoot = deriveProjectRoot(path)
    if (projectRoot) {
      const issueId = (doc as any)?.plan?.id ?? 'unknown'
      queueAutoCommit({
        projectRoot,
        paths: [path],
        subject: `chore(state): update spec for ${String(issueId).toUpperCase()} (status=${doc.status})`,
      })
    }
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

function entryFromFile(
  specsDir: string,
  filename: string,
): Effect.Effect<PanSpecEntry | null, never> {
  return Effect.gen(function* () {
    const parts = parseVBriefFilename(filename)
    if (!parts) return null
    const path = join(specsDir, filename)
    const document = yield* readSpec(path).pipe(
      Effect.catch((err) => {
        console.warn(`[specs] Skipping invalid spec ${filename}: ${(err as Error).message ?? String(err)}`)
        return Effect.succeed(null as PanSpecDocument | null)
      }),
    )
    if (!document) return null
    return {
      path,
      filename,
      issueId: parts.issueId,
      slug: parts.slug,
      date: parts.date,
      status: document.status,
      document,
    }
  })
}

export function listSpecs(
  projectRoot: string,
  options: PanSpecListOptions = {},
): Effect.Effect<PanSpecEntry[], FsError> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const { specsDir } = projectPanPaths(projectRoot)
    const exists = yield* fs.exists(specsDir).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!exists) return []

    const filenames = yield* fs.readDirectory(specsDir).pipe(
      Effect.mapError((cause) => new FsError({ path: specsDir, operation: 'readDirectory', cause })),
    )

    const entries: PanSpecEntry[] = []
    for (const filename of filenames) {
      const entry = yield* entryFromFile(specsDir, filename)
      if (entry && (!options.status || entry.status === options.status)) {
        entries.push(entry)
      }
    }

    entries.sort((a, b) => a.filename.localeCompare(b.filename))
    return entries
  }).pipe(Effect.provide(NodeFileSystem.layer))
}

export function findSpecByIssue(
  projectRoot: string,
  issueId: string,
): Effect.Effect<PanSpecEntry | null, FsError> {
  return Effect.gen(function* () {
    const upperIssueId = issueId.toUpperCase()
    const all = yield* listSpecs(projectRoot)
    return all.find((entry) => entry.issueId.toUpperCase() === upperIssueId) ?? null
  })
}


export function buildPanSpecFilename(issueId: string, slug: string, createdDate?: Date | string): string {
  return generateVBriefFilename(issueId, slug, createdDate)
}

export function buildPanSpecPath(
  projectRoot: string,
  issueId: string,
  slug: string,
  createdDate?: Date | string,
): string {
  return join(projectPanPaths(projectRoot).specsDir, buildPanSpecFilename(issueId, slugify(slug), createdDate))
}

export function writeSpecForIssue(
  projectRoot: string,
  doc: VBriefDocument,
  status: PanSpecStatus,
  filename?: string,
): Effect.Effect<PanSpecEntry, FsError> {
  return Effect.gen(function* () {
    const paths = yield* ensurePanDirs(projectRoot)
    const specDocument = asPanSpecDocument(doc, status)
    const nextFilename = filename ?? generateVBriefFilename(doc.plan.id, doc.plan.title)
    const path = join(paths.specsDir, nextFilename)
    yield* writeSpec(path, specDocument)
    invalidateVBriefIndex(projectRoot)
    return {
      path,
      filename: nextFilename,
      issueId: doc.plan.id,
      slug: parseVBriefFilename(nextFilename)?.slug ?? slugify(doc.plan.title),
      date: parseVBriefFilename(nextFilename)?.date ?? new Date().toISOString().slice(0, 10),
      status,
      document: specDocument,
    }
  })
}

export function updateSpecStatus(
  projectRoot: string,
  issueId: string,
  newStatus: PanSpecStatus,
): Effect.Effect<PanSpecEntry | null, FsError> {
  return Effect.gen(function* () {
    const existing = yield* findSpecByIssue(projectRoot, issueId)
    if (!existing) return null
    if (existing.status === newStatus) return existing

    const nextDocument: PanSpecDocument = {
      ...existing.document,
      status: newStatus,
    }
    yield* writeSpec(existing.path, nextDocument)
    invalidateVBriefIndex(projectRoot)
    return {
      ...existing,
      status: newStatus,
      document: nextDocument,
    }
  })
}
