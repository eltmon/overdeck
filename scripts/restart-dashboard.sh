#!/bin/bash
# Restart Panopticon dashboard cleanly
# Usage: ./restart-dashboard.sh

set -e

DASHBOARD_DIR="$(dirname "$0")/../src/dashboard"
LOG_FILE="/tmp/dashboard.log"

echo "🛑 Stopping dashboard..."

# Kill any existing dashboard processes
pkill -9 -f "tsx.*server/index.ts" 2>/dev/null || true
pkill -9 -f "vite.*dashboard/frontend" 2>/dev/null || true
pkill -9 -f "concurrently.*dashboard" 2>/dev/null || true

# Also kill by port if processes are orphaned
fuser -k 3010/tcp 2>/dev/null || true
fuser -k 3011/tcp 2>/dev/null || true

sleep 2

# Verify ports are free
if fuser 3010/tcp 3011/tcp 2>/dev/null; then
  echo "❌ Ports still in use, force killing..."
  fuser -k -9 3010/tcp 3011/tcp 2>/dev/null || true
  sleep 1
fi

echo "🚀 Starting dashboard..."

# Start fresh
cd "$DASHBOARD_DIR"
rm -f "$LOG_FILE"
nohup npm run dev > "$LOG_FILE" 2>&1 &

# Wait for API to be ready
echo "⏳ Waiting for API..."
for i in {1..30}; do
  if curl -s --max-time 2 http://localhost:3011/api/health > /dev/null 2>&1; then
    echo "✅ Dashboard ready!"
    echo "   Frontend: http://localhost:3010"
    echo "   API: http://localhost:3011"
    exit 0
  fi
  sleep 1
done

echo "⚠️  API not responding after 30s. Check logs: tail -f $LOG_FILE"
exit 1
