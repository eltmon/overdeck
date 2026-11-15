import { describe, expect, it } from 'vitest'
import { File, FileCode, FileCog, FileImage, FileJson, FileLock, FileSpreadsheet, FileSymlink, FileTerminal, FileText, Folder, FolderOpen } from 'lucide-react'
import { fileIconFor } from '../fileIcons'

const CASES: Array<[string, unknown, string | undefined]> = [
  ['ts', FileCode, 'TS'],
  ['tsx', FileCode, 'TSX'],
  ['js', FileCode, 'JS'],
  ['mjs', FileCode, 'JS'],
  ['cjs', FileCode, 'JS'],
  ['json', FileJson, 'JSON'],
  ['md', FileText, 'MD'],
  ['mdx', FileText, 'MD'],
  ['py', FileCode, 'PY'],
  ['lua', FileCode, 'LUA'],
  ['rs', FileCode, 'RS'],
  ['go', FileCode, 'GO'],
  ['sh', FileTerminal, 'SH'],
  ['yml', FileCog, undefined],
  ['yaml', FileCog, undefined],
  ['toml', FileCog, undefined],
  ['css', FileCode, 'CSS'],
  ['html', FileCode, 'HTML'],
  ['svg', FileImage, undefined],
  ['png', FileImage, undefined],
  ['jpg', FileImage, undefined],
  ['pdf', FileText, 'PDF'],
  ['csv', FileSpreadsheet, undefined],
  ['lock', FileLock, undefined],
]

describe('fileIconFor', () => {
  it.each(CASES)('maps .%s to its icon and label', (ext, Icon, label) => {
    expect(fileIconFor(`name.${ext}`, 'file', false)).toEqual(label ? { Icon, label } : { Icon })
  })

  it('matches the extension case-insensitively', () => {
    expect(fileIconFor('A.TSX', 'file', false)).toEqual({ Icon: FileCode, label: 'TSX' })
  })

  it('uses the plain File glyph for an unknown extension or none', () => {
    expect(fileIconFor('notes.xyz', 'file', false)).toEqual({ Icon: File })
    expect(fileIconFor('Makefile', 'file', false)).toEqual({ Icon: File })
  })

  it('shows folders open or closed and symlinks as FileSymlink', () => {
    expect(fileIconFor('src', 'dir', true)).toEqual({ Icon: FolderOpen })
    expect(fileIconFor('src', 'dir', false)).toEqual({ Icon: Folder })
    expect(fileIconFor('link.ts', 'symlink', false)).toEqual({ Icon: FileSymlink })
  })
})
