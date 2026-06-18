# End-to-End Test Plan: Traefik + Local Domain Setup

This document outlines the E2E testing procedure for PAN-4.

## Prerequisites

Before running the test:

- [ ] Docker daemon is running: `docker ps`
- [ ] mkcert is installed: `which mkcert`
- [ ] Clean test environment: `rm -rf ~/.panopticon`

## Test Procedure

### 1. Installation Test

```bash
# Run installation
pan install

# Expected output:
# ✓ Directories initialized
# ✓ Docker network ready
# ✓ mkcert CA installed
# ✓ Wildcard certificates generated (*.pan.localhost, *.localhost)
# ✓ Traefik configuration created
# ✓ Config created

# Verify directories were created
ls ~/.panopticon
# Expected: agents/ backups/ certs/ commands/ config.toml costs/ skills/ templates/ traefik/

# Verify Traefik config files
ls ~/.panopticon/traefik/
# Expected: README.md docker-compose.yml dynamic/ traefik.yml certs/

# Verify certificates
ls ~/.panopticon/traefik/certs/
# Expected: _wildcard.pan.localhost-key.pem  _wildcard.pan.localhost.pem

# Verify config.toml contains traefik section
cat ~/.panopticon/config.toml | grep -A 3 "\[traefik\]"
# Expected:
# [traefik]
# enabled = true
# dashboard_port = 8080
# domain = "pan.localhost"
```

### 2. DNS Setup Test

```bash
# Add to /etc/hosts (one-time setup)
echo "127.0.0.1 pan.localhost traefik.pan.localhost" | sudo tee -a /etc/hosts

# Verify DNS resolution
ping -c 1 pan.localhost
# Expected: PING pan.localhost (127.0.0.1) 56(84) bytes of data.

# Test with nslookup
nslookup pan.localhost
# Expected: Address: 127.0.0.1
```

### 3. Startup Test (pan up)

```bash
# Start Overdeck
pan up --detach

# Expected output:
# Starting Overdeck...
#
# Starting Traefik...
# ✓ Traefik started
#   Dashboard: http://localhost:8080
#   HTTPS:     https://pan.localhost
#
# Starting dashboard...
# ✓ Dashboard started in background
#   Frontend:  https://pan.localhost
#   API:       https://pan.localhost/api
#   (fallback: http://localhost:3001, http://localhost:3002)

# Verify Traefik container is running
docker ps | grep panopticon-traefik
# Expected: panopticon-traefik container in "Up" state

# Verify Traefik dashboard accessible
curl -I http://localhost:8080
# Expected: HTTP/1.1 200 OK

# Verify HTTPS frontend accessible
curl -k -I https://pan.localhost
# Expected: HTTP/2 200 (or 404 if dashboard not fully started)

# Verify certificate is trusted (after mkcert -install)
curl -I https://pan.localhost
# Expected: No certificate errors

# Wait for dashboard to start
sleep 5

# Check dashboard frontend
curl -I https://pan.localhost
# Expected: HTTP/2 200

# Check dashboard API
curl -I https://pan.localhost/api/health
# Expected: HTTP/2 200 (if health endpoint exists)
```

### 4. Port-based Fallback Test

```bash
# Verify port-based access still works
curl -I http://localhost:3001
# Expected: HTTP/1.1 200 OK

curl -I http://localhost:3002
# Expected: HTTP/1.1 200 OK (or 404 depending on root route)
```

### 5. Traefik Routing Test

```bash
# Test Traefik is proxying correctly

# Frontend should route to :3001
curl -v https://pan.localhost 2>&1 | grep -E "(< HTTP|< location)"

# API should route to :3002 and strip /api prefix
curl -v https://pan.localhost/api/health 2>&1 | grep -E "(< HTTP|< location)"
```

### 6. Shutdown Test (pan down)

```bash
# Stop Overdeck
pan down

# Expected output:
# Stopping Overdeck...
#
# Stopping dashboard...
# ✓ Dashboard stopped
#
# Stopping Traefik...
# ✓ Traefik stopped
#
# Overdeck stopped

# Verify Traefik container stopped
docker ps | grep panopticon-traefik
# Expected: No output

# Verify ports are free
lsof -ti:3001
# Expected: No output (empty)

lsof -ti:3002
# Expected: No output (empty)

curl -I https://pan.localhost
# Expected: Connection refused
```

### 7. Minimal Mode Test

```bash
# Clean environment
rm -rf ~/.panopticon

# Install in minimal mode (no Traefik)
pan install --minimal

# Verify config has traefik disabled
cat ~/.panopticon/config.toml | grep -A 3 "\[traefik\]"
# Expected:
# [traefik]
# enabled = false

# Start without Traefik
pan up --detach

# Expected: Only dashboard starts, no Traefik messages

# Verify only port-based access works
curl -I http://localhost:3001
# Expected: HTTP/1.1 200 OK

curl -I https://pan.localhost
# Expected: Connection refused

# Clean up
pan down
```

## Test Results Matrix

| Test Case | Expected Result | Status |
|-----------|----------------|--------|
| pan install creates directories | ~/.panopticon/ with subdirs | ⏳ |
| pan install generates certificates | Wildcard certs in traefik/certs/ | ⏳ |
| pan install creates traefik config | docker-compose.yml, traefik.yml, dynamic/ | ⏳ |
| pan install sets traefik.enabled=true | Config has [traefik] section | ⏳ |
| DNS resolution works | ping pan.localhost succeeds | ⏳ |
| pan up starts Traefik | Docker container running | ⏳ |
| pan up starts dashboard | Ports 3001/3002 in use | ⏳ |
| HTTPS access works | curl https://pan.localhost succeeds | ⏳ |
| Traefik dashboard accessible | curl http://localhost:8080 succeeds | ⏳ |
| pan down stops everything | No containers, ports free | ⏳ |
| Minimal mode skips Traefik | traefik.enabled=false in config | ⏳ |

## Common Issues

### "Docker daemon not running"

**Solution:** Start Docker:
```bash
sudo systemctl start docker  # Linux
# or
# Start Docker Desktop (Mac/Windows)
```

### "mkcert: command not found"

**Solution:** Install mkcert:
```bash
# macOS
brew install mkcert

# Linux
sudo apt install mkcert

# WSL2
sudo apt install mkcert
```

### Certificate errors despite mkcert

**Solution:** Install CA and restart browser:
```bash
mkcert -install
# Restart browser
```

### Ports 3001/3002 already in use

**Solution:** Kill existing processes:
```bash
lsof -ti:3001 | xargs kill -9
lsof -ti:3002 | xargs kill -9
```

## Performance Checks

- [ ] `pan install` completes in < 30 seconds
- [ ] `pan up` completes in < 10 seconds
- [ ] `pan down` completes in < 5 seconds
- [ ] HTTPS response time < 100ms (localhost)

## Security Checks

- [ ] Wildcard certificate only trusted locally
- [ ] Traefik dashboard not exposed on 0.0.0.0
- [ ] No certificate errors in browser after mkcert install
- [ ] docker.sock mounted read-only

## Cleanup

```bash
# Remove test installation
rm -rf ~/.panopticon

# Remove hosts entry
sudo sed -i.bak '/pan.localhost/d' /etc/hosts

# Remove Docker resources
docker rm -f panopticon-traefik
docker network rm panopticon
```

## Automated Test Script

See `tests/e2e-traefik.sh` for an automated version of this test plan.
