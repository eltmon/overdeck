#!/bin/bash
# Restart Panopticon dashboard cleanly
# Usage: ./restart-dashboard.sh

DASHBOARD_DIR="$(dirname "$0")/../src/dashboard"
LOG_FILE="/tmp/dashboard.log"

echo "🛑 Stopping dashboard..."

# Kill dashboard processes by matching patterns in the full command line
# The patterns need to match what `ps aux` shows
pids=$(ps aux | grep -E "panopticon.*dashboard|tsx watch index|concurrently.*dev:server" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
  echo "   Killing $(echo "$pids" | wc -w) processes..."
  echo "$pids" | xargs -r kill -9 2>/dev/null || true
fi

# Also kill by port if processes are orphaned
fuser -k 3010/tcp 2>/dev/null || true
fuser -k 3011/tcp 2>/dev/null || true

sleep 2

# Double-check and force kill any stragglers
pids=$(ps aux | grep -E "panopticon.*dashboard|tsx watch index|concurrently.*dev:server" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
  echo "   Force killing stragglers..."
  echo "$pids" | xargs -r kill -9 2>/dev/null || true
  sleep 1
fi

# Verify ports are free
if fuser 3010/tcp 2>/dev/null || fuser 3011/tcp 2>/dev/null; then
  echo "❌ Ports still in use, force killing by port..."
  fuser -k -9 3010/tcp 2>/dev/null || true
  fuser -k -9 3011/tcp 2>/dev/null || true
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
