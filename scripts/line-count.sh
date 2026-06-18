#!/bin/bash
# Line count snapshot for codebase comparison (pre/post migration)
# Usage: ./scripts/line-count.sh

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

echo "=== OVERDECK-CLI v${VERSION} — Codebase Line Count ==="
echo ""

echo "--- By Directory ---"
for dir in src/cli src/dashboard/server src/dashboard/frontend/src src/lib packages/contracts/src; do
  if [ -d "$dir" ]; then
    count=$(find "$dir" -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".test." | grep -v "__tests__" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
    files=$(find "$dir" -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".test." | grep -v "__tests__" | wc -l)
    printf "%8s lines  %4s files  %s\n" "$count" "$files" "$dir"
  fi
done

echo ""
echo "--- Key Files ---"
for f in src/dashboard/server/index.ts src/dashboard/server/main.ts src/dashboard/frontend/src/components/KanbanBoard.tsx src/dashboard/frontend/src/App.tsx src/dashboard/frontend/src/store/store.ts src/dashboard/server/event-store.ts src/dashboard/server/ws-rpc.ts; do
  if [ -f "$f" ]; then
    printf "%8s  %s\n" "$(wc -l < "$f")" "$f"
  fi
done

echo ""
echo "--- Tests ---"
test_lines=$(find src/ -name "*.test.*" 2>/dev/null | grep -v node_modules | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
test_files=$(find src/ -name "*.test.*" 2>/dev/null | grep -v node_modules | wc -l)
echo "${test_lines} lines across ${test_files} test files"

echo ""
echo "--- Total Source (non-test TS/TSX) ---"
total=$(find src/ packages/ -name "*.ts" -o -name "*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v ".test." | grep -v "__tests__" | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
echo "${total} lines"

echo ""
echo "--- Dependencies ---"
echo "express:    $(grep -c '"express"' package.json src/dashboard/server/package.json 2>/dev/null | tail -1) references"
echo "socket.io:  $(grep -c '"socket.io"' package.json src/dashboard/server/package.json 2>/dev/null | tail -1) references"
echo "effect:     $(grep -c '"effect"' package.json packages/*/package.json 2>/dev/null | tail -1) references"
echo "zustand:    $(grep -c '"zustand"' src/dashboard/frontend/package.json 2>/dev/null) references"
