# PAN-4 End-to-End Test Plan

## Prerequisites
- Clean test environment (or --minimal flag to skip Traefik)
- Docker running
- mkcert installed
- No existing ~/.overdeck/traefik/ directory

## Test Scenario 1: Fresh Install with Traefik

### Step 1: Install
```bash
pan install
```

**Expected Results:**
- Creates ~/.overdeck/traefik/ directory structure
- Copies template files from package:
  - docker-compose.yml
  - traefik.yml
  - dynamic/overdeck.yml
  - README.md
- Generates mkcert wildcard certificates:
  - ~/.overdeck/traefik/certs/_wildcard.pan.localhost.pem
  - ~/.overdeck/traefik/certs/_wildcard.pan.localhost-key.pem
- Creates config.toml with traefik.enabled = true
- Shows next steps message including DNS setup

**Verification:**
```bash
ls -la ~/.overdeck/traefik/
# Should show: docker-compose.yml, traefik.yml, dynamic/, certs/, README.md

cat ~/.overdeck/config.toml | grep -A3 "\[traefik\]"
# Should show: enabled = true, dashboard_port = 8080, domain = "pan.localhost"
```

### Step 2: Configure DNS
```bash
echo "127.0.0.1 pan.localhost" | sudo tee -a /etc/hosts
```

### Step 3: Start Services
```bash
pan up
```

**Expected Results:**
- Starts Traefik container via docker-compose
- Shows Traefik dashboard URL: https://traefik.pan.localhost:8080
- Starts dashboard (frontend on 3010, API on 3011)
- Shows frontend URL: https://pan.localhost
- Shows API URL: https://pan.localhost/api

**Verification:**
```bash
docker ps | grep traefik
# Should show: overdeck-traefik container running

curl -k https://pan.localhost
# Should connect to dashboard frontend

curl -k https://pan.localhost/api/health
# Should connect to dashboard API
```

### Step 4: Stop Services
```bash
pan down
```

**Expected Results:**
- Stops dashboard processes (ports 3010, 3011)
- Stops Traefik container via docker-compose down

**Verification:**
```bash
docker ps | grep traefik
# Should show: no containers

lsof -ti:3010,3011
# Should show: no processes
```

## Test Scenario 2: Minimal Install (No Traefik)

```bash
pan install --minimal
```

**Expected Results:**
- Skips Traefik setup entirely
- Creates config.toml with traefik.enabled = false
- pan up uses port-based routing (http://localhost:3010, http://localhost:3011)

## Integration Points

### 1. Template File Resolution
- SOURCE_TRAEFIK_TEMPLATES resolves to package templates/ directory
- copyDirectoryRecursive() copies all files recursively

### 2. Config File Integration
- install creates [traefik] section in config.toml
- up/down read config.toml to determine if Traefik is enabled

### 3. Docker Compose Integration
- install copies docker-compose.yml to ~/.overdeck/traefik/
- up runs: docker-compose up -d (in traefik dir)
- down runs: docker-compose down (in traefik dir)

### 4. Certificate Integration
- install generates wildcard certs via mkcert
- traefik.yml references certs in TLS config
- dynamic/overdeck.yml includes TLS certificates section

## Manual Verification Steps

Since we can't run full E2E in production environment, verify:

1. **Build Success**: ✅ DONE
   ```bash
   npm run build
   # Exit code 0, no TypeScript errors
   ```

2. **Template Path Resolution**: ✅ DONE
   ```bash
   node -e "import('./dist/chunk-*.js').then(m => console.log(m.SOURCE_TRAEFIK_TEMPLATES))"
   # Should resolve to correct path
   ```

3. **Templates Exist**: ✅ DONE
   ```bash
   ls -la templates/traefik/
   # Should show: docker-compose.yml, traefik.yml, dynamic/, README.md
   ```

4. **Command Registration**: ✅ VERIFIED
   - pan install command registered
   - pan up command handles Traefik
   - pan down command handles Traefik

## Risk Assessment

### Low Risk
- Template file changes (DRY improvement)
- Path resolution refactoring
- README.md added to templates

### Medium Risk
- copyDirectoryRecursive() is new - not tested in production
- Package root resolution depends on bundler output

### Recommended Testing
- Test in isolated VM or container
- Test on Linux, macOS, WSL2
- Test with fresh install (no existing ~/.overdeck/)
- Test upgrade path (existing ~/.overdeck/ with inline configs)

## Success Criteria

✅ Build succeeds without errors
✅ Template files exist and are complete
✅ Path resolution works correctly
✅ Commands are registered and handle Traefik
✅ Documentation is comprehensive

⏸️ Full E2E test deferred to avoid affecting production environment
