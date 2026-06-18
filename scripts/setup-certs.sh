#!/bin/bash
# Setup local HTTPS certificates for Overdeck using mkcert
# This script generates trusted certificates for *.pan.localhost

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="${SCRIPT_DIR}/../templates/traefik/certs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "Setting up local HTTPS certificates for Overdeck..."

# Check if mkcert is installed
if ! command -v mkcert &> /dev/null; then
    echo -e "${RED}Error: mkcert is not installed.${NC}"
    echo ""
    echo "Install mkcert first:"
    echo "  macOS:   brew install mkcert"
    echo "  Linux:   apt install mkcert  OR  brew install mkcert"
    echo "  Windows: choco install mkcert"
    echo ""
    echo "More info: https://github.com/FiloSottile/mkcert"
    exit 1
fi

echo -e "${GREEN}mkcert found at $(which mkcert)${NC}"

# Check if CA is installed
CAROOT=$(mkcert -CAROOT 2>/dev/null)
if [ -f "$CAROOT/rootCA.pem" ]; then
    echo -e "${GREEN}Local CA already exists at $CAROOT${NC}"
else
    echo -e "${YELLOW}Installing local CA...${NC}"
    echo "This may require sudo password to add CA to system trust store."
    mkcert -install
    echo -e "${GREEN}CA installed successfully${NC}"
fi

# Create certs directory if it doesn't exist
mkdir -p "$CERTS_DIR"

# Generate certificates for pan.localhost
echo ""
echo "Generating certificates for *.pan.localhost..."
cd "$CERTS_DIR"

# Generate wildcard cert for pan.localhost
mkcert -cert-file "_wildcard.pan.localhost.pem" \
       -key-file "_wildcard.pan.localhost-key.pem" \
       "pan.localhost" "*.pan.localhost"

echo ""
echo -e "${GREEN}Certificates generated successfully!${NC}"
echo ""
echo "Certificate files:"
ls -la "$CERTS_DIR"/*.pem
echo ""
echo "You can now start Traefik:"
echo "  cd templates/traefik && docker compose up -d"
echo ""
echo "Access the dashboard at: https://pan.localhost"
