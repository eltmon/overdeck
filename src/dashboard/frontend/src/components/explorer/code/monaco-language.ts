/**
 * Monaco language for a file path (PAN-5187, D-C15).
 *
 * The server's `lang` field uses Shiki ids, which are not Monaco ids, so
 * the code pane picks the language from the path against Monaco's own
 * language list: an exact filename first (`Dockerfile`), then the longest
 * matching extension, case-insensitive. `.mdx` maps to markdown.
 */

export interface MonacoLanguageInfo {
  id: string
  extensions?: readonly string[]
  filenames?: readonly string[]
}

const EXPLICIT_EXTENSIONS: Record<string, string> = { '.mdx': 'markdown' }

export function monacoLanguageForPath(path: string, languages: readonly MonacoLanguageInfo[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()

  for (const language of languages) {
    if (language.filenames?.some((f) => f.toLowerCase() === name)) return language.id
  }

  for (const [extension, id] of Object.entries(EXPLICIT_EXTENSIONS)) {
    if (name.endsWith(extension)) return id
  }

  let best: { id: string; length: number } | null = null
  for (const language of languages) {
    for (const extension of language.extensions ?? []) {
      const lower = extension.toLowerCase()
      if (name.endsWith(lower) && name.length > lower.length && (!best || lower.length > best.length)) {
        best = { id: language.id, length: lower.length }
      }
    }
  }
  return best?.id ?? 'plaintext'
}
