# Pan Dashboard Restart

Compile and restart the Panopticon dashboard with dependency installation.

## Triggers

- "restart dashboard"
- "compile dashboard"
- "dashboard restart"
- "rebuild dashboard"

## Steps

1. **Install dependencies** in both frontend and server:
   ```bash
   cd /home/eltmon/projects/panopticon/src/dashboard/frontend && npm install
   cd /home/eltmon/projects/panopticon/src/dashboard && npm install
   ```

2. **Kill existing processes**:
   ```bash
   pkill -f "node.*dashboard" 2>/dev/null || true
   pkill -f "vite.*3010" 2>/dev/null || true
   sleep 2
   ```

3. **Start the dashboard**:
   ```bash
   cd /home/eltmon/projects/panopticon/src/dashboard && npm run dev > /tmp/dashboard.log 2>&1 &
   ```

4. **Wait and verify health**:
   ```bash
   sleep 6
   curl -s http://localhost:3011/api/health
   ```

5. **Report status** to user:
   - If health check returns `{"status":"ok"...}` - success
   - If health check fails - check `/tmp/dashboard.log` for errors

## Notes

- Frontend runs on port 3010
- API server runs on port 3011
- Logs are written to `/tmp/dashboard.log`
- The `npm run dev` command runs both frontend (vite) and backend (tsx watch) concurrently
