# DNS Setup for Overdeck

Overdeck uses local domain names for HTTPS development. This guide explains how to configure DNS resolution for `pan.localhost` and wildcard domains.

## Automatic Setup (Recommended)

`pan install` automatically detects your platform and configures DNS:

```bash
pan install
# Auto-detects: WSL2 → wsl2hosts, macOS/Linux → dnsmasq (if installed) or hosts_file
```

The DNS sync method is stored in `config.toml`:

```toml
[traefik]
enabled = true
domain = "pan.localhost"
dns_sync_method = "wsl2hosts"  # or "hosts_file" or "dnsmasq"
```

`pan up` also ensures DNS is configured before starting services.

## Manual Setup

If you need to configure DNS manually or troubleshoot, see below.

### Linux / macOS (Native)

Add this line to `/etc/hosts`:

```bash
127.0.0.1 pan.localhost
```

**Edit the file:**
```bash
sudo nano /etc/hosts
# or
sudo vim /etc/hosts
```

**Verify:**
```bash
ping pan.localhost
# Should respond from 127.0.0.1
```

### WSL2 (Windows Subsystem for Linux)

WSL2 requires special handling because `/etc/hosts` changes don't sync to Windows.

#### Option 1: wsl2hosts (Default for WSL2)

Overdeck uses `~/.wsl2hosts` to sync DNS entries to Windows via a scheduled task:

```bash
# pan install sets this up automatically
# Entries are added to ~/.wsl2hosts and synced to Windows hosts file
```

#### Option 2: dnsmasq (Recommended for wildcard support)

Install and configure dnsmasq for wildcard DNS:

```bash
# Install dnsmasq
sudo apt update && sudo apt install -y dnsmasq

# Create Overdeck DNS config
sudo tee /etc/dnsmasq.d/panopticon.conf > /dev/null <<EOF
# Resolve all *.localhost domains to 127.0.0.1
address=/localhost/127.0.0.1

# Resolve pan.localhost specifically
address=/pan.localhost/127.0.0.1
EOF

# Restart dnsmasq
sudo systemctl restart dnsmasq

# Update resolv.conf to use dnsmasq
sudo tee /etc/resolv.conf > /dev/null <<EOF
nameserver 127.0.0.1
nameserver 8.8.8.8
nameserver 8.8.4.4
EOF
```

**Verify:**
```bash
nslookup pan.localhost
# Should resolve to 127.0.0.1

nslookup feature-pan-4.pan.localhost
# Should also resolve to 127.0.0.1
```

#### Option 3: Manual /etc/hosts (Simple but Limited)

If you don't need wildcard support, use `/etc/hosts`:

```bash
# Add to WSL /etc/hosts
echo "127.0.0.1 pan.localhost" | sudo tee -a /etc/hosts

# Also add to Windows hosts file
# (Run PowerShell as Administrator)
Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value "127.0.0.1 pan.localhost"
```

**Limitation:** This won't work for wildcard domains like `feature-pan-4.pan.localhost`.

## Wildcard Domain Support

### Modern Browsers (Chrome, Firefox, Safari)

Good news! Modern browsers automatically resolve `*.localhost` to `127.0.0.1` without any configuration.

This means domains like:
- `feature-pan-4.pan.localhost`
- `api-feature-pan-4.pan.localhost`
- Any `*.localhost` subdomain

...will automatically work in your browser.

### System-wide Wildcard (Linux/macOS)

For system-wide wildcard support (curl, CLI tools, etc.), use dnsmasq:

**macOS:**
```bash
# Install dnsmasq
brew install dnsmasq

# Configure wildcard
echo 'address=/localhost/127.0.0.1' | sudo tee /usr/local/etc/dnsmasq.d/localhost.conf

# Start dnsmasq
brew services start dnsmasq

# Add to resolvers
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

**Linux:**
```bash
# Install dnsmasq
sudo apt install dnsmasq  # Debian/Ubuntu
sudo dnf install dnsmasq  # Fedora/RHEL

# Configure wildcard
echo 'address=/localhost/127.0.0.1' | sudo tee /etc/dnsmasq.d/localhost.conf

# Restart
sudo systemctl restart dnsmasq
sudo systemctl restart NetworkManager  # If using NetworkManager
```

## Troubleshooting

### "pan.localhost" doesn't resolve

1. **Check /etc/hosts:**
   ```bash
   cat /etc/hosts | grep pan.localhost
   ```

2. **Clear DNS cache:**
   ```bash
   # macOS
   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

   # Linux (systemd-resolved)
   sudo systemd-resolve --flush-caches

   # WSL2
   sudo /etc/init.d/dnsmasq restart
   ```

3. **Test with curl:**
   ```bash
   curl -k https://pan.localhost
   # Should connect (even if certificate error)
   ```

### WSL2: Domains work in WSL but not in Windows browser

You need to sync `/etc/hosts` to Windows:

```bash
# From WSL, update Windows hosts file
grep pan.localhost /etc/hosts | sudo tee -a /mnt/c/Windows/System32/drivers/etc/hosts
```

Or use the dnsmasq approach (Option 1 above).

### Certificate Errors in Browser

This is expected! You need to trust the mkcert CA:

1. **Install mkcert:**
   ```bash
   # macOS
   brew install mkcert nss  # nss for Firefox support

   # Linux
   sudo apt install mkcert libnss3-tools

   # WSL2
   sudo apt install mkcert libnss3-tools
   ```

2. **Install CA:**
   ```bash
   mkcert -install
   ```

3. **Restart browser** - Certificate errors should disappear.

### Wildcard domains don't work

1. **Browser:** Should work automatically (Chrome, Firefox, Safari support `*.localhost`)

2. **System-wide (curl, etc.):** Need dnsmasq (see "Wildcard Domain Support" above)

3. **Test:**
   ```bash
   # Should work in browser without dnsmasq
   open https://any-subdomain.localhost

   # For CLI tools, need dnsmasq
   curl -k https://any-subdomain.localhost
   ```

## Platform-Specific Notes

### macOS

- `/etc/hosts` requires sudo to edit
- Changes take effect immediately (no restart needed)
- For wildcard support, dnsmasq is the cleanest solution

### Linux (Native)

- `/etc/hosts` requires sudo to edit
- systemd-resolved may interfere - check with `resolvectl status`
- NetworkManager may override DNS settings

### WSL2

- **Important:** WSL2 uses a virtual network adapter
- `/etc/hosts` in WSL doesn't affect Windows
- Use dnsmasq for wildcard support
- Windows hosts file: `C:\Windows\System32\drivers\etc\hosts`

## Security Considerations

- `.localhost` is a reserved TLD (RFC 6761) - safe to use locally
- Never use real domain names (like `.dev`) without owning them
- mkcert certificates are only trusted on your machine
- Traefik dashboard (port 8080) is intentionally insecure for local dev

## References

- [RFC 6761: Special-Use Domain Names](https://tools.ietf.org/html/rfc6761)
- [mkcert Documentation](https://github.com/FiloSottile/mkcert)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
