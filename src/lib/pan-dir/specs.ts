import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join } from 'path'

import { VBriefMergeConflictError } from '../vbrief/io.js'
import { generateVBriefFilename, parseVBriefFilename, slugify } from '../vbrief/lifecycle.js'
import { invalidateVBriefIndex } from '../vbrief/vbrief-index.js'
import type { VBriefDocument } from '../vbrief/types.js'
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

export function ensurePanDirs(projectRoot: string): ProjectPanPaths {
  const paths = projectPanPaths(projectRoot)
  mkdirSync(paths.panDir, { recursive: true })
  mkdirSync(paths.specsDir, { recursive: true })
  mkdirSync(paths.draftsDir, { recursive: true })
  mkdirSync(paths.continuesDir, { recursive: true })
  return paths
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

function parsePanSpecDocument(path: string): PanSpecDocument {
  const raw = readFileSync(path, 'utf-8')
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
        `See docs/VBRIEF.md for the correct format.`
    )
  }

  return doc as unknown as PanSpecDocument
}

export function readSpec(path: string): PanSpecDocument {
  return parsePanSpecDocument(path)
}

export function writeSpec(path: string, doc: PanSpecDocument): void {
  if (!isPanSpecStatus(doc.status)) {
    throw new Error(`Invalid pan spec status for ${path}: ${String(doc.status)}`)
  }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8')
  renameSync(tmp, path)
}

function entryFromFile(specsDir: string, filename: string): PanSpecEntry | null {
  const parts = parseVBriefFilename(filename)
  if (!parts) return null
  const path = join(specsDir, filename)
  try {
    const document = readSpec(path)
    return {
      path,
      filename,
      issueId: parts.issueId,
      slug: parts.slug,
      date: parts.date,
      status: document.status,
      document,
    }
  } catch (err) {
    console.warn(`[specs] Skipping invalid spec ${filename}: ${(err as Error).message}`)
    return null
  }
}

export function listSpecs(projectRoot: string, options: PanSpecListOptions = {}): PanSpecEntry[] {
  const { specsDir } = projectPanPaths(projectRoot)
  if (!existsSync(specsDir)) return []

  const entries = readdirSync(specsDir)
    .map(filename => entryFromFile(specsDir, filename))
    .filter((entry): entry is PanSpecEntry => entry !== null)
    .filter(entry => !options.status || entry.status === options.status)

  entries.sort((a, b) => a.filename.localeCompare(b.filename))
  return entries
}

export function findSpecByIssue(projectRoot: string, issueId: string): PanSpecEntry | null {
  const upperIssueId = issueId.toUpperCase()
  return listSpecs(projectRoot).find(entry => entry.issueId.toUpperCase() === upperIssueId) ?? null
}

async function parsePanSpecDocumentAsync(path: string): Promise<PanSpecDocument> {
  const raw = await readFile(path, 'utf-8')
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
        `See docs/VBRIEF.md for the correct format.`
    )
  }

  return doc as unknown as PanSpecDocument
}

/** Async variant of findSpecByIssue that does not parse unrelated specs. */
export async function findSpecByIssueAsync(projectRoot: string, issueId: string): Promise<PanSpecEntry | null> {
  const upperIssueId = issueId.toUpperCase()
  const { specsDir } = projectPanPaths(projectRoot)

  let filenames: string[]
  try {
    filenames = await (await import('fs/promises')).readdir(specsDir)
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }

  for (const filename of filenames) {
    const parts = parseVBriefFilename(filename)
    if (!parts || parts.issueId.toUpperCase() !== upperIssueId) continue
    const path = join(specsDir, filename)
    try {
      const document = await parsePanSpecDocumentAsync(path)
      return {
        path,
        filename,
        issueId: parts.issueId,
        slug: parts.slug,
        date: parts.date,
        status: document.status,
        document,
      }
    } catch (err) {
      console.warn(`[specs] Skipping invalid spec ${filename}: ${(err as Error).message}`)
    }
  }
  return null
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
): PanSpecEntry {
  const paths = ensurePanDirs(projectRoot)
  const specDocument = asPanSpecDocument(doc, status)
  const nextFilename = filename ?? generateVBriefFilename(doc.plan.id, doc.plan.title)
  const path = join(paths.specsDir, nextFilename)
  writeSpec(path, specDocument)
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
}

export function updateSpecStatus(projectRoot: string, issueId: string, newStatus: PanSpecStatus): PanSpecEntry | null {
  const existing = findSpecByIssue(projectRoot, issueId)
  if (!existing) return null
  if (existing.status === newStatus) return existing

  const nextDocument: PanSpecDocument = {
    ...existing.document,
    status: newStatus,
  }
  writeSpec(existing.path, nextDocument)
  invalidateVBriefIndex(projectRoot)
  return {
    ...existing,
    status: newStatus,
    document: nextDocument,
  }
}
