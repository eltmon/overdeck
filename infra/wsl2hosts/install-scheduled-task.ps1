# Install Panopticon WSL2Hosts Sync Scheduled Task
# Run this script as Administrator to set up automatic DNS sync
#
# The task runs every 5 minutes and on login to keep hosts in sync

$ErrorActionPreference = "Stop"

$taskName = "PanopticonWsl2HostsSync"
$scriptPath = "$env:USERPROFILE\.panopticon\sync-wsl2hosts.ps1"
$panopticonDir = "$env:USERPROFILE\.panopticon"

# Create .panopticon directory if needed
if (-not (Test-Path $panopticonDir)) {
    New-Item -ItemType Directory -Path $panopticonDir -Force | Out-Null
}

# Copy sync script to .panopticon
$sourceScript = Join-Path $PSScriptRoot "sync-wsl2hosts.ps1"
if (Test-Path $sourceScript) {
    Copy-Item $sourceScript $scriptPath -Force
    Write-Host "Copied sync script to $scriptPath"
} else {
    Write-Error "Source script not found at $sourceScript"
    exit 1
}

# Remove existing task if present
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed existing scheduled task"
}

# Also remove old MYN-specific task if it exists
$oldTask = Get-ScheduledTask -TaskName "SyncMynHosts" -ErrorAction SilentlyContinue
if ($oldTask) {
    Unregister-ScheduledTask -TaskName "SyncMynHosts" -Confirm:$false
    Write-Host "Removed legacy SyncMynHosts task"
}

# Create trigger: every 5 minutes
$trigger = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)),
    (New-ScheduledTaskTrigger -AtLogOn)
)

# Create action
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

# Create principal (run with highest privileges)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# Create settings
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register task
Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Principal $principal -Settings $settings -Description "Syncs WSL ~/.wsl2hosts to Windows hosts file for local development domains"

Write-Host ""
Write-Host "Successfully installed scheduled task: $taskName"
Write-Host "The task will run every 5 minutes and on login."
Write-Host ""
Write-Host "To run immediately: Start-ScheduledTask -TaskName '$taskName'"
