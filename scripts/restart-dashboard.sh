#!/bin/bash
# Restart Panopticon dashboard cleanly
# Usage: ./restart-dashboard.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="$SCRIPT_DIR/../src/dashboard"
LOG_FILE="/tmp/panopticon-dashboard.log"

echo "Stopping dashboard..."

# Most reliable: kill by port using fuser -k
for port in 3010 3011 3012; do
  fuser -k ${port}/tcp 2>/dev/null || true
done

# Also kill any npm/node processes that might be orphaned
pkill -9 -f "npm.*dashboard" 2>/dev/null || true
pkill -9 -f "node.*panopticon.*dashboard" 2>/dev/null || true
pkill -9 -f "vite.*301" 2>/dev/null || true
pkill -9 -f "concurrently.*dev:server" 2>/dev/null || true

sleep 2

# Verify ports are clear
if lsof -i :3010,:3011,:3012 >/dev/null 2>&1; then
  echo "Warning: Ports still in use, force killing..."
  lsof -ti :3010,:3011,:3012 | xargs -r kill -9 2>/dev/null || true
  sleep 1
fi

echo "Starting dashboard..."

cd "$DASHBOARD_DIR"
rm -f "$LOG_FILE"

# Use setsid to fully detach from terminal
setsid npm run dev > "$LOG_FILE" 2>&1 &

# Wait for API to be ready
echo -n "Waiting for API"
for i in {1..30}; do
  if curl -s --max-time 2 http://localhost:3011/api/health > /dev/null 2>&1; then
    echo ""
    echo "Dashboard ready!"
    echo "  Frontend: http://localhost:3010"
    echo "  API:      http://localhost:3011"
    echo "  Logs:     $LOG_FILE"
    exit 0
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "ERROR: API not responding after 30s"
echo "Check logs: tail -50 $LOG_FILE"
exit 1
