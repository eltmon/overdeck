import { describe, expect, it } from 'vitest'
import { monacoLanguageForPath, type MonacoLanguageInfo } from '../monaco-language'

const LANGUAGES: MonacoLanguageInfo[] = [
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'typescript', extensions: ['.ts', '.tsx', '.cts', '.mts'] },
  { id: 'markdown', extensions: ['.md', '.markdown'] },
  { id: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'xml', extensions: ['.xml'] },
  { id: 'kustomize', extensions: ['.kustomize.yaml'] },
]

describe('monacoLanguageForPath', () => {
  it('matches a filename first', () => {
    expect(monacoLanguageForPath('docker/Dockerfile', LANGUAGES)).toBe('dockerfile')
  })

  it('matches extensions case-insensitively', () => {
    expect(monacoLanguageForPath('src/App.TS', LANGUAGES)).toBe('typescript')
    expect(monacoLanguageForPath('README.Markdown', LANGUAGES)).toBe('markdown')
  })

  it('maps .mdx to markdown', () => {
    expect(monacoLanguageForPath('docs/page.mdx', LANGUAGES)).toBe('markdown')
  })

  it('prefers the longest matching extension', () => {
    expect(monacoLanguageForPath('base/app.kustomize.yaml', LANGUAGES)).toBe('kustomize')
    expect(monacoLanguageForPath('base/app.yaml', LANGUAGES)).toBe('yaml')
  })

  it('falls back to plaintext', () => {
    expect(monacoLanguageForPath('notes.unknownext', LANGUAGES)).toBe('plaintext')
    expect(monacoLanguageForPath('Makefile', LANGUAGES)).toBe('plaintext')
    expect(monacoLanguageForPath('.ts', LANGUAGES)).toBe('plaintext')
  })
})
