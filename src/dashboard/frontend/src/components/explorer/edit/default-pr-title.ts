/**
 * The Create PR dialog's default title (PAN-5191 D-F12). A conventional-commit
 * subject, because repository commit hooks (commitlint here) run on the
 * explorer's commit and reject a bare sentence.
 */
const MAX_TITLE = 100

function basename(path: string): string {
  const parts = path.split('/').filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}

/** `paths` are the git status paths: uncommitted entries first, then committed ones. */
export function defaultPrTitle(paths: readonly string[]): string {
  const unique = [...new Set(paths)]
  let title: string
  if (unique.length === 0) title = 'chore: edit files'
  else if (unique.length === 1) title = `chore: edit ${basename(unique[0]!)}`
  else title = `chore: edit ${basename(unique[0]!)} and ${unique.length - 1} more files`
  return title.slice(0, MAX_TITLE)
}
