# Panopticon WSL2 Hosts Sync
# Syncs entries from ~/.wsl2hosts in WSL to Windows hosts file
# This enables local development domains (*.localhost, *.test) to resolve correctly
#
# Usage: Run as scheduled task or manually with admin privileges
# Install: pan doctor --fix (creates scheduled task automatically)

$ErrorActionPreference = "Stop"

# Get current WSL IP
$wslIp = (wsl hostname -I).Trim().Split()[0]
if (-not $wslIp) {
    Write-Error "Failed to get WSL IP address"
    exit 1
}

# Marker for auto-generated entries (allows safe cleanup/refresh)
$marker = "# panopticon-auto"
$hosts = "C:\Windows\System32\drivers\etc\hosts"

# Read current hosts file, filtering out our auto-generated entries
$content = @(Get-Content $hosts | Where-Object { $_ -notmatch $marker })

# Read ~/.wsl2hosts from WSL and add each entry
$wsl2hostsContent = wsl cat ~/.wsl2hosts 2>$null
if ($wsl2hostsContent) {
    $wsl2hostsContent -split "`n" | ForEach-Object {
        $hostname = $_.Trim()
        # Skip empty lines and comments
        if ($hostname -and $hostname -notmatch "^#") {
            $content += "$wslIp`t$hostname`t$marker"
        }
    }
}

# Write back to hosts file
try {
    $content | Out-File -FilePath $hosts -Encoding ASCII
    Write-Host "Successfully synced $(($wsl2hostsContent -split "`n" | Where-Object { $_.Trim() -and $_.Trim() -notmatch "^#" }).Count) entries to hosts file"
} catch {
    Write-Error "Failed to write hosts file. Run as Administrator."
    exit 1
}
