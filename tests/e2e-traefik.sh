#!/usr/bin/env bash
#
# E2E Test Script for Traefik + Local Domain Setup
# Tests the complete installation and startup flow
#

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

test_start() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${YELLOW}▶${NC} Test $TESTS_RUN: $1"
}

test_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓${NC} PASS"
}

test_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗${NC} FAIL: $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test environment..."

    # Stop Panopticon
    pan down 2>/dev/null || true

    # Remove test installation
    if [ "$CLEAN_PANOPTICON" = "true" ]; then
        rm -rf ~/.panopticon.test
    fi

    # Remove Docker resources
    docker rm -f panopticon-traefik 2>/dev/null || true
    docker network rm panopticon 2>/dev/null || true
}

# Trap cleanup on exit
trap cleanup EXIT

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Please install Docker first."
    exit 1
fi

if ! docker ps &> /dev/null; then
    log_error "Docker daemon not running. Please start Docker."
    exit 1
fi

if ! command -v mkcert &> /dev/null; then
    log_warn "mkcert not found. Certificate tests will be skipped."
fi

if ! command -v pan &> /dev/null; then
    log_error "pan CLI not found. Build and install first: npm run build && npm link"
    exit 1
fi

# Use test environment
export PANOPTICON_HOME=~/.panopticon.test
export CLEAN_PANOPTICON=true

log_info "Using test environment: $PANOPTICON_HOME"

# Test 1: Clean installation
test_start "pan install creates all required directories and configs"
rm -rf $PANOPTICON_HOME
pan install --skip-mkcert > /dev/null 2>&1

if [ -d "$PANOPTICON_HOME/traefik" ] && \
   [ -f "$PANOPTICON_HOME/traefik/docker-compose.yml" ] && \
   [ -f "$PANOPTICON_HOME/traefik/traefik.yml" ] && \
   [ -f "$PANOPTICON_HOME/traefik/dynamic/panopticon.yml" ] && \
   [ -f "$PANOPTICON_HOME/config.toml" ]; then
    test_pass
else
    test_fail "Missing required files or directories"
    exit 1
fi

# Test 2: Config contains Traefik section
test_start "config.toml contains traefik section"
if grep -q "\[traefik\]" "$PANOPTICON_HOME/config.toml" && \
   grep -q "enabled = true" "$PANOPTICON_HOME/config.toml"; then
    test_pass
else
    test_fail "Traefik section missing or disabled in config"
    exit 1
fi

# Test 3: Docker network created
test_start "Docker network 'panopticon' exists"
if docker network ls | grep -q panopticon; then
    test_pass
else
    test_fail "Docker network not created"
    exit 1
fi

# Test 4: docker-compose.yml uses external network (regression test for PAN-45)
test_start "docker-compose.yml correctly references external network"
if grep -q "external: true" "$PANOPTICON_HOME/traefik/docker-compose.yml"; then
    # Verify docker-compose config is valid (no label mismatch)
    if cd "$PANOPTICON_HOME/traefik" && docker-compose config > /dev/null 2>&1; then
        test_pass
    else
        test_fail "docker-compose config validation failed - network label mismatch?"
        exit 1
    fi
else
    test_fail "docker-compose.yml missing 'external: true' for panopticon network"
    exit 1
fi

# Test 5: Traefik starts successfully
test_start "pan up starts Traefik container"
pan up --detach > /dev/null 2>&1
sleep 3  # Wait for services to start

if docker ps | grep -q panopticon-traefik; then
    test_pass
else
    test_fail "Traefik container not running"
    docker logs panopticon-traefik 2>&1 | tail -20
    exit 1
fi

# Test 6: Traefik dashboard accessible
test_start "Traefik dashboard accessible on :8080"
if curl -sf http://localhost:8080 > /dev/null; then
    test_pass
else
    test_fail "Traefik dashboard not accessible"
fi

# Test 7: Dashboard ports are in use
test_start "Dashboard running on ports 3001 and 3002"
FRONTEND_RUNNING=false
API_RUNNING=false

# Check multiple times (dashboard takes time to start)
for i in {1..10}; do
    if lsof -ti:3001 > /dev/null 2>&1; then
        FRONTEND_RUNNING=true
        break
    fi
    sleep 1
done

for i in {1..10}; do
    if lsof -ti:3002 > /dev/null 2>&1; then
        API_RUNNING=true
        break
    fi
    sleep 1
done

if [ "$FRONTEND_RUNNING" = true ] && [ "$API_RUNNING" = true ]; then
    test_pass
else
    test_fail "Dashboard not running on expected ports"
fi

# Test 8: HTTPS endpoint responds (if DNS configured)
test_start "HTTPS endpoint https://pan.localhost responds"
if curl -k -sf https://pan.localhost > /dev/null 2>&1; then
    test_pass
else
    log_warn "HTTPS endpoint not accessible (DNS may not be configured)"
    log_warn "Add to /etc/hosts: 127.0.0.1 pan.localhost"
fi

# Test 9: Port-based access still works
test_start "Port-based access works (http://localhost:3001)"
if curl -sf http://localhost:3001 > /dev/null 2>&1; then
    test_pass
else
    test_fail "Port-based frontend not accessible"
fi

# Test 10: pan down stops everything
test_start "pan down stops Traefik and dashboard"
pan down > /dev/null 2>&1
sleep 2

TRAEFIK_STOPPED=false
FRONTEND_STOPPED=false
API_STOPPED=false

if ! docker ps | grep -q panopticon-traefik; then
    TRAEFIK_STOPPED=true
fi

if ! lsof -ti:3001 > /dev/null 2>&1; then
    FRONTEND_STOPPED=true
fi

if ! lsof -ti:3002 > /dev/null 2>&1; then
    API_STOPPED=true
fi

if [ "$TRAEFIK_STOPPED" = true ] && \
   [ "$FRONTEND_STOPPED" = true ] && \
   [ "$API_STOPPED" = true ]; then
    test_pass
else
    test_fail "Not all services stopped cleanly"
fi

# Test 11: Minimal mode skips Traefik
test_start "pan install --minimal disables Traefik"
rm -rf $PANOPTICON_HOME
pan install --minimal --skip-mkcert > /dev/null 2>&1

if grep -q "enabled = false" "$PANOPTICON_HOME/config.toml"; then
    test_pass
else
    test_fail "Minimal mode did not disable Traefik"
fi

# Summary
echo ""
echo "================================"
echo "Test Summary"
echo "================================"
echo -e "Total:  $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    log_info "All tests passed! ✨"
    exit 0
else
    log_error "Some tests failed. See output above."
    exit 1
fi
