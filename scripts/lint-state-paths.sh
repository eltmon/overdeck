#!/usr/bin/env bash
#
# lint-state-paths.sh — prevent new direct derivations of canonical spec/draft paths.
# Test fixtures are excluded because they intentionally exercise legacy layouts.
# Audited migration and path-authority modules remain allowlisted below.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -gt 1 ]]; then
  echo "usage: bash scripts/lint-state-paths.sh [scan-root]" >&2
  exit 2
fi

scan_root="${1:-src}"
if [[ ! -d "$scan_root" ]]; then
  echo "state-path lint: scan root does not exist: $scan_root" >&2
  exit 2
fi

node - "$scan_root" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = process.cwd()
const scanRoot = path.resolve(process.argv[2])
const allowlisted = new Set([
  'src/lib/state-read-home.ts',
  'src/lib/state-plane.ts',
  'src/lib/orders/validate.ts',
  'src/lib/cloister/merge-agent.ts',
  'src/lib/overdeck/planning-promotion.ts',
  'src/cli/commands/admin/state-migrate.ts',
  'src/lib/cloister/verification-runner.ts',
])

function logicalPath(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function isExcluded(file) {
  const logical = logicalPath(file)
  return logical.includes('/__tests__/')
    || /\.test\.[jt]sx?$/.test(logical)
    || logical.startsWith('src/lib/pan-dir/')
    || allowlisted.has(logical)
}

function sourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (entry.isFile() && /\.(?:js|ts|tsx)$/.test(entry.name)) files.push(full)
  }
  return files
}

function maskComments(source) {
  const chars = [...source]
  let state = 'code'
  let quote = ''

  for (let i = 0; i < chars.length; i += 1) {
    const current = chars[i]
    const next = chars[i + 1]

    if (state === 'line-comment') {
      if (current === '\n') state = 'code'
      else chars[i] = ' '
      continue
    }

    if (state === 'block-comment') {
      if (current === '\n') continue
      if (current === '*' && next === '/') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 1
        state = 'code'
      } else {
        chars[i] = ' '
      }
      continue
    }

    if (state === 'string') {
      if (current === '\\') {
        i += 1
        continue
      }
      if (current === quote) {
        state = 'code'
        quote = ''
      }
      continue
    }

    if (current === '/' && next === '/') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 1
      state = 'line-comment'
    } else if (current === '/' && next === '*') {
      chars[i] = ' '
      chars[i + 1] = ' '
      i += 1
      state = 'block-comment'
    } else if (current === "'" || current === '"' || current === '`') {
      state = 'string'
      quote = current
    }
  }

  return chars.join('')
}

const patterns = [
  /(['"`])\.pan\1\s*,\s*(['"`])(specs|drafts)\2/g,
  /(['"`])\.pan\/(specs|drafts)\1/g,
]
const violations = []

for (const file of sourceFiles(scanRoot).sort()) {
  if (isExcluded(file)) continue
  const source = fs.readFileSync(file, 'utf8')
  const masked = maskComments(source)
  const lines = source.split(/\r?\n/)
  const seen = new Set()

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
      const line = masked.slice(0, match.index).split('\n').length
      const key = `${line}:${match[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      violations.push(`${logicalPath(file)}:${line}:${lines[line - 1] ?? ''}`)
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.log(violation)
  console.error(`✖ state-path lint found ${violations.length} direct spec/draft path derivation(s). Use getProjectPanPaths(projectRoot).`)
  process.exit(1)
}

console.log('✓ state-path lint passed (canonical spec/draft paths use getProjectPanPaths)')
NODE
