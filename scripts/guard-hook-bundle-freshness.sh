#!/usr/bin/env bash
# PAN-2699: sync-sources/hooks/*.js are committed build artifacts of the
# sibling *.ts sources (bundled via `npm run build:scripts`). The default
# build no longer regenerates them, so a hook-source change that lands
# without its rebuilt bundle would silently ship stale hook behavior.
# This guard requires any pushed range that touches a hook source to also
# touch its built bundle. Deliberately path-based (no rebuild): cheap,
# deterministic, and immune to bundler nondeterminism.
set -euo pipefail

range="${1:-}"
[ -z "$range" ] && exit 0

changed=$(git diff --name-only "$range" -- 'sync-sources/hooks/' || true)
[ -z "$changed" ] && exit 0

fail=0
while IFS= read -r file; do
  case "$file" in
    sync-sources/hooks/*.ts)
      base="${file%.ts}"
      # .d.ts declarations are outputs, not sources
      case "$file" in *.d.ts) continue ;; esac
      js="${base}.js"
      if git cat-file -e "HEAD:$js" 2>/dev/null && ! echo "$changed" | grep -qx "$js"; then
        echo "✖ $file changed but its built bundle $js did not — run 'npm run build:scripts' and commit the result (PAN-2699)." >&2
        fail=1
      fi
      ;;
  esac
done <<EOF
$changed
EOF

if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "✓ hook-bundle freshness guard passed"
