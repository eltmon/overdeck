# WSL2 Hosts Sync

Automatically syncs local development domains from WSL to Windows hosts file.

## How It Works

1. Panopticon writes workspace DNS entries to `~/.wsl2hosts` in WSL when creating workspaces
2. A Windows scheduled task reads this file every 5 minutes
3. Entries are added to `C:\Windows\System32\drivers\etc\hosts` with the current WSL IP
4. Your browser can now access `https://feature-pan-123.pan.localhost`

## Installation

### Automatic (Recommended)

```bash
pan doctor --fix
```

This will detect if the scheduled task is missing and offer to install it.

### Manual

From PowerShell (as Administrator):

```powershell
cd \\wsl$\Ubuntu-20.04\home\eltmon\projects\panopticon\infra\wsl2hosts
.\install-scheduled-task.ps1
```

Or copy the files manually:

```powershell
# Copy sync script
Copy-Item "\\wsl$\Ubuntu-20.04\home\eltmon\projects\panopticon\infra\wsl2hosts\sync-wsl2hosts.ps1" "$env:USERPROFILE\.panopticon\"

# Create scheduled task (run as admin)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$env:USERPROFILE\.panopticon\sync-wsl2hosts.ps1`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "PanopticonWsl2HostsSync" -Trigger $trigger -Action $action -RunLevel Highest
```

## Usage

### Adding DNS Entries

Panopticon automatically manages `~/.wsl2hosts` when you:

- Create a workspace: `pan workspace create PAN-123`
- Destroy a workspace: `pan workspace destroy PAN-123`

You can also manually add entries:

```bash
echo "myapp.localhost" >> ~/.wsl2hosts
```

### Triggering Sync Manually

```powershell
Start-ScheduledTask -TaskName "PanopticonWsl2HostsSync"
```

Or run the script directly:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.panopticon\sync-wsl2hosts.ps1"
```

### Checking Status

```powershell
# View task status
Get-ScheduledTask -TaskName "PanopticonWsl2HostsSync" | Get-ScheduledTaskInfo

# View synced entries
Get-Content C:\Windows\System32\drivers\etc\hosts | Select-String "panopticon-auto"
```

## Troubleshooting

### Entries not appearing in hosts file

1. Check if the scheduled task exists:
   ```powershell
   Get-ScheduledTask -TaskName "PanopticonWsl2HostsSync"
   ```

2. Check task last run result:
   ```powershell
   Get-ScheduledTask -TaskName "PanopticonWsl2HostsSync" | Get-ScheduledTaskInfo
   ```

3. Run the sync manually to see errors:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.panopticon\sync-wsl2hosts.ps1"
   ```

### Permission denied

The sync script needs Administrator privileges to write to the hosts file. The scheduled task runs as SYSTEM which has the required permissions.

### WSL IP changed

The sync script automatically detects the current WSL IP on each run. If your IP changed, just wait for the next sync (5 minutes) or trigger manually.

## Migration from SyncMynHosts

If you have the old `SyncMynHosts` task, the installation script will automatically remove it and create the new `PanopticonWsl2HostsSync` task.

The new task uses a different marker (`# panopticon-auto` instead of `# myn-auto`) but will continue to sync all entries from `~/.wsl2hosts`.
