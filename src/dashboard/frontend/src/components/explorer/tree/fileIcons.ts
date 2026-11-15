// File icons for explorer tree rows (PAN-5289 §6.8, B-D13).
//
// An extension maps to a lucide glyph and, for code and text formats, a short
// monospace label the row shows in place of the glyph. Icons stay neutral:
// the mockup's brand-coloured badges use hex colours the style guide forbids.

import {
  File,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileSymlink,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react'

export interface FileIcon {
  Icon: LucideIcon
  /** Short extension label shown instead of the glyph. */
  label?: string
}

const BY_EXTENSION: Readonly<Record<string, FileIcon>> = {
  ts: { Icon: FileCode, label: 'TS' },
  tsx: { Icon: FileCode, label: 'TSX' },
  js: { Icon: FileCode, label: 'JS' },
  mjs: { Icon: FileCode, label: 'JS' },
  cjs: { Icon: FileCode, label: 'JS' },
  json: { Icon: FileJson, label: 'JSON' },
  md: { Icon: FileText, label: 'MD' },
  mdx: { Icon: FileText, label: 'MD' },
  py: { Icon: FileCode, label: 'PY' },
  lua: { Icon: FileCode, label: 'LUA' },
  rs: { Icon: FileCode, label: 'RS' },
  go: { Icon: FileCode, label: 'GO' },
  sh: { Icon: FileTerminal, label: 'SH' },
  yml: { Icon: FileCog },
  yaml: { Icon: FileCog },
  toml: { Icon: FileCog },
  css: { Icon: FileCode, label: 'CSS' },
  html: { Icon: FileCode, label: 'HTML' },
  svg: { Icon: FileImage },
  png: { Icon: FileImage },
  jpg: { Icon: FileImage },
  pdf: { Icon: FileText, label: 'PDF' },
  csv: { Icon: FileSpreadsheet },
  lock: { Icon: FileLock },
}

const PLAIN_FILE: FileIcon = { Icon: File }

export function fileIconFor(name: string, kind: 'file' | 'dir' | 'symlink', expanded: boolean): FileIcon {
  if (kind === 'dir') return { Icon: expanded ? FolderOpen : Folder }
  if (kind === 'symlink') return { Icon: FileSymlink }
  const dot = name.lastIndexOf('.')
  if (dot < 0) return PLAIN_FILE
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? PLAIN_FILE
}
