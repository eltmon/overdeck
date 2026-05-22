---
name: pan-network
description: Traefik, local domains, and platform-specific networking setup
triggers:
  - pan network
  - traefik setup
  - local https
  - local domain
  - networking setup
  - dns setup
allowed-tools:
  - Bash
  - Read
  - Write
---

# Networking & Traefik Setup

## Overview

This skill guides you through setting up Traefik reverse proxy for local HTTPS, configuring local domains, and handling platform-specific networking (Linux, macOS, WSL2).

## When to Use

- Setting up local HTTPS for development
- Configuring *.pan.localhost domains
- Troubleshooting network connectivity between containers
- Platform-specific DNS configuration

## Architecture

```
Browser
   ↓
https://myapp.pan.localhost
   ↓
Traefik (port 443/80)
   ↓
Docker containers (internal ports)
```

## Quick Start

### 1. Start Traefik

```bash
cd /path/to/panopticon/templates/traefik
docker compose up -d
```

### 2. Add DNS Entry

```bash
# Linux/macOS
echo "127.0.0.1 pan.localhost" | sudo tee -a /etc/hosts
echo "127.0.0.1 traefik.pan.localhost" | sudo tee -a /etc/hosts
echo "127.0.0.1 myapp.pan.localhost" | sudo tee -a /etc/hosts

# Or use wildcard (requires dnsmasq)
```

### 3. Verify

- Dashboard: https://pan.localhost
- Traefik UI: https://traefik.pan.localhost:8080

## Platform-Specific Setup

### Linux

**DNS:**
```bash
# Add to /etc/hosts
sudo tee -a /etc/hosts << 'EOF'
127.0.0.1 pan.localhost
127.0.0.1 traefik.pan.localhost
EOF
```

**Wildcard DNS (optional):**
```bash
# Install dnsmasq
sudo apt install dnsmasq

# Configure
echo "address=/pan.localhost/127.0.0.1" | sudo tee /etc/dnsmasq.d/pan.localhost.conf

# Restart
sudo systemctl restart dnsmasq
```

### macOS

**DNS:**
```bash
# Add to /etc/hosts
sudo tee -a /etc/hosts << 'EOF'
127.0.0.1 pan.localhost
127.0.0.1 traefik.pan.localhost
EOF
```

**Wildcard DNS (optional):**
```bash
# Install dnsmasq
brew install dnsmasq

# Configure
echo "address=/pan.localhost/127.0.0.1" >> $(brew --prefix)/etc/dnsmasq.conf

# Start
sudo brew services start dnsmasq

# Point .localhost to dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

### WSL2

WSL2 has additional complexity because:
1. WSL2 has a different IP than Windows
2. Windows hosts file is separate from WSL2

**Option A: Port Forwarding (Recommended)**

```powershell
# In PowerShell (Admin)
# Forward ports from Windows to WSL2
netsh interface portproxy add v4tov4 listenport=80 listenaddress=0.0.0.0 connectport=80 connectaddress=$(wsl hostname -I)
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$(wsl hostname -I)
```

Then add to Windows hosts file (`C:\Windows\System32\drivers\etc\hosts`):
```
127.0.0.1 pan.localhost
127.0.0.1 traefik.pan.localhost
```

**Option B: Use WSL2 IP Directly**

```bash
# Get WSL2 IP
hostname -I

# Add to Windows hosts (replace with actual IP)
# 172.x.x.x pan.localhost
```

Note: WSL2 IP changes on restart.

**Option C: Use localhost Tunneling**

Install `socat` in WSL2:
```bash
sudo apt install socat
socat TCP-LISTEN:443,fork,reuseaddr TCP:$(hostname -I | awk '{print $1}'):443
```

## Traefik Configuration

### Directory Structure

```
templates/traefik/
├── docker-compose.yml
├── traefik.yml           # Static config
├── dynamic/
│   ├── panopticon.yml    # Panopticon dashboard routing
│   └── workspace.yml.template  # Template for workspaces
└── certs/
    ├── _wildcard.pan.localhost.pem
    └── _wildcard.pan.localhost-key.pem
```

### Add a New Route

Create `dynamic/myapp.yml`:

```yaml
http:
  routers:
    myapp:
      rule: "Host(`myapp.pan.localhost`)"
      service: myapp
      tls: {}

  services:
    myapp:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:3000"
```

Traefik auto-detects changes in the `dynamic/` directory.

### Docker Labels Method

In your `docker-compose.yml`:

```yaml
services:
  app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.myapp.rule=Host(`myapp.pan.localhost`)"
      - "traefik.http.routers.myapp.tls=true"
      - "traefik.http.services.myapp.loadbalancer.server.port=3000"
    networks:
      - traefik

networks:
  traefik:
    external: true
    name: traefik_default
```

## Certificate Management

### Using Provided Certs

Panopticon includes pre-generated wildcard certs for `*.pan.localhost`:
- Valid for development only
- Auto-trusted by most browsers for localhost

### Generate New Certs with mkcert

```bash
# Install mkcert
brew install mkcert  # macOS
# or
sudo apt install mkcert  # Linux

# Install CA
mkcert -install

# Generate wildcard cert
cd templates/traefik/certs
mkcert "*.pan.localhost" pan.localhost localhost 127.0.0.1 ::1
```

## Troubleshooting

### "Connection Refused"

```bash
# Check Traefik is running
docker ps | grep traefik

# Check Traefik logs
docker logs traefik

# Verify DNS resolves
ping pan.localhost
```

### "Certificate Error"

```bash
# Trust the CA (if using mkcert)
mkcert -install

# Or add exception in browser
```

### "502 Bad Gateway"

```bash
# Check target service is running
docker ps

# Check Traefik can reach service
docker network inspect traefik_default

# Verify service is on traefik network
docker network connect traefik_default <container_name>
```

### WSL2 Specific Issues

**"Can't reach from Windows browser":**
```powershell
# Check port forwarding
netsh interface portproxy show all

# Re-add if missing
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=$(wsl hostname -I)
```

**"WSL2 IP changed":**
```powershell
# Update port forwarding with new IP
netsh interface portproxy delete v4tov4 listenport=443 listenaddress=0.0.0.0
netsh interface portproxy add v4tov4 listenport=443 listenaddress=0.0.0.0 connectport=443 connectaddress=<new-ip>
```

## Commands Reference

```bash
# Start Traefik
pan up

# Stop Traefik
pan down

# View Traefik dashboard
# https://traefik.pan.localhost:8080

# List Traefik routes
curl -s http://localhost:8080/api/http/routers | jq

# Check service health
curl -k https://pan.localhost/health
```

## Related Skills

- `/pan:docker` - Docker template selection
- `/pan:up` - Start Panopticon services
- `/pan:down` - Stop Panopticon services
