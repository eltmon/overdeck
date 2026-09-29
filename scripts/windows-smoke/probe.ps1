#Requires -Version 7
<#
PAN-4331 W2: run the windows-smoke step catalogue in one environment and write
one results JSON file (schema: .pan/drafts/PAN-4331.md "Results JSON schema").

  pwsh -File probe.ps1 -Env windows-pwsh -Subject <overdeck-core-*.tgz> -Fixture <dir> -Out <results.json>

-Fixture is the directory make-fixture.sh filled (origin.git, vault.git,
passphrase.txt, fixture.json). Every step is wrapped so a failure is recorded
and the next step still runs (NFR-1); each catalogue id appears exactly once.

The subject tarball is installed once with `npm install --prefix`, and every
subject step runs its `pan` bin shim, which is what a cached `npx
@overdeck/core` runs. (`npx -p <tgz>` re-extracts the 38 MB tarball on every
call: 90-120 s per call on windows-2022 in run 36595332191.) Every subject
command runs with stdin closed and a timeout, so a prompt or a hang becomes a
recorded failure.

-SkipServe records steps 1c-2b as not-run. It exists only for trying the probe
on a machine whose port 3011 already serves a real dashboard.
#>
param(
  [Parameter(Mandatory)][Alias('Env')][string]$EnvName,
  [Parameter(Mandatory)][string]$Subject,
  [Parameter(Mandatory)][string]$Fixture,
  [Parameter(Mandatory)][string]$Out,
  [int]$Port = 3011,
  [switch]$SkipServe
)

$ErrorActionPreference = 'Continue'
$PSStyle.OutputRendering = 'PlainText'
$env:NO_COLOR = '1'

$Catalogue = [ordered]@{
  '1a' = 'npx @overdeck/core@latest --version'
  '1b' = 'npx @overdeck/core@latest vault list'
  '1c' = 'serve starts and answers GET /'
  '1d' = 'browser open'
  '2a' = 'dashboard GET APIs'
  '2b' = 'POST /api/conversations'
  '3a' = 'vault join'
  '3b' = 'vault list --json'
  '3c' = 'vault resume --no-launch'
  '3d' = 'materialized transcript'
  '3e' = 'Claude Code pickup (CP-2)'
  '3f' = 'home resolution'
  '3g' = 'vault resume (launch claude)'
  '4a' = 'code snapshot applied'
  '4b' = 'code content'
  '4c' = 'git status after apply'
  '4d' = 'line endings'
  '4e' = 'exec bit'
  '4f' = 'symlink'
  '5a' = 'WSL2 available'
}
$ZeroSession = '00000000-0000-4000-8000-000000000000'
$Token = 'windows-smoke-internal-token'

$Subject = (Resolve-Path -LiteralPath $Subject).Path
$Fixture = (Resolve-Path -LiteralPath $Fixture).Path
$FixtureInfo = Get-Content -Raw -LiteralPath (Join-Path $Fixture 'fixture.json') | ConvertFrom-Json -AsHashtable
$TempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$ProbeTemp = Join-Path $TempBase "windows-smoke-$EnvName"
$ClonePath = [IO.Path]::GetFullPath((Join-Path $TempBase 'w' 'proj'))
New-Item -ItemType Directory -Force -Path $ProbeTemp | Out-Null

$Steps = [ordered]@{}

function Get-Tail([string]$Text) {
  if ($null -eq $Text) { return '' }
  if ($Text.Length -gt 4000) { return $Text.Substring($Text.Length - 4000) }
  return $Text
}

function Add-Step([string]$Id, [string]$Status, [string]$Command, $ExitCode, [string]$Evidence, [string]$Note = '', $Seconds = $null) {
  $Steps[$Id] = [ordered]@{
    id = $Id; status = $Status; command = $Command; exitCode = $ExitCode
    evidence = (Get-Tail $Evidence); note = $Note; seconds = $Seconds
  }
}

# Run one catalogue step. The script block returns a hashtable with status and,
# optionally, exitCode, evidence and note; a throw is recorded as fail.
function Invoke-Step([string]$Id, [string]$Display, [scriptblock]$Command) {
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $r = & $Command
    Add-Step $Id $r.status $Display $r.exitCode ([string]$r.evidence) ([string]$r.note) ([Math]::Round($clock.Elapsed.TotalSeconds, 1))
  } catch {
    Add-Step $Id 'fail' $Display $null ($_ | Out-String) 'the probe step threw' ([Math]::Round($clock.Elapsed.TotalSeconds, 1))
  }
}

# Start an executable with stdin closed and stdout/stderr read in the
# background. Returns Process = $null (and Error) when it cannot start.
function Start-Timed([string]$File, [string[]]$Arguments, [string]$Cwd = (Get-Location).Path) {
  $app = Get-Command $File -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $app) { return [pscustomobject]@{ Process = $null; Error = "$File is not on PATH" } }
  $psi = [System.Diagnostics.ProcessStartInfo]::new($app.Source)
  foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
  $psi.WorkingDirectory = $Cwd
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
  } catch {
    return [pscustomobject]@{ Process = $null; Error = ($_ | Out-String) }
  }
  $p.StandardInput.Close()
  [pscustomobject]@{ Process = $p; Stdout = $p.StandardOutput.ReadToEndAsync(); Stderr = $p.StandardError.ReadToEndAsync() }
}

# Kill a started process and its whole tree.
function Stop-Tree($Started) {
  $p = $Started.Process
  if ($IsWindows) { & taskkill /T /F /PID $p.Id 2>&1 | Out-Null }
  try { $p.Kill($true) } catch { }
  $p.WaitForExit(10000) | Out-Null
}

# stdout followed by stderr of a started process that has exited or been killed.
function Get-TimedOutput($Started) {
  [void]$Started.Stdout.Wait(10000)
  [void]$Started.Stderr.Wait(10000)
  $text = ''
  if ($Started.Stdout.IsCompleted) { $text += $Started.Stdout.Result }
  if ($Started.Stderr.IsCompleted) { $text += $Started.Stderr.Result }
  $text
}

# Run an executable with stdin closed and a timeout; kill its tree on timeout.
# Output is stdout followed by stderr.
function Invoke-Timed([string]$File, [string[]]$Arguments, [string]$Cwd = (Get-Location).Path, [int]$TimeoutSec = 300) {
  $s = Start-Timed $File $Arguments $Cwd
  if (-not $s.Process) {
    return [pscustomobject]@{ ExitCode = $null; Output = $s.Error; TimedOut = $false; Started = $false }
  }
  $timedOut = -not $s.Process.WaitForExit($TimeoutSec * 1000)
  if ($timedOut) { Stop-Tree $s }
  $text = Get-TimedOutput $s
  if ($timedOut) { $text += "`n[probe: killed after $TimeoutSec s]" }
  $code = if ($timedOut) { $null } else { $s.Process.ExitCode }
  return [pscustomobject]@{ ExitCode = $code; Output = $text; TimedOut = $timedOut; Started = $true }
}

# The process tree under $RootId (command lines) and what listens on $Port.
function Get-ServeSnapshot([int]$RootId, [int]$Port) {
  $all = foreach ($proc in Get-Process) {
    $parent = $null
    try { $parent = $proc.Parent.Id } catch { }
    [pscustomobject]@{ Id = $proc.Id; Parent = $parent; Cmd = $proc.CommandLine }
  }
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($RootId)
  do {
    $grew = $false
    foreach ($p in $all) { if ($null -ne $p.Parent -and $ids.Contains([int]$p.Parent) -and $ids.Add([int]$p.Id)) { $grew = $true } }
  } while ($grew)
  $tree = ($all | Where-Object { $ids.Contains([int]$_.Id) } | ForEach-Object { "$($_.Id) <- $($_.Parent): $($_.Cmd)" }) -join "`n"
  $listen = if ($IsWindows) {
    (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid $($_.OwningProcess)" }) -join "`n"
  } else { (& ss -ltnp "sport = :$Port" 2>&1 | Out-String).Trim() }
  "--- process tree under $RootId ---`n$tree`n--- listening on $Port ---`n$(if ($listen) { $listen } else { '(nothing)' })"
}

$SubjectPrefix = Join-Path $ProbeTemp 'subject'
$PanBin = if ($IsWindows) { Join-Path $SubjectPrefix 'node_modules' '.bin' 'pan.cmd' } else { Join-Path $SubjectPrefix 'node_modules' '.bin' 'pan' }

function Invoke-Pan([string[]]$Arguments, [int]$TimeoutSec = 300, [string]$Cwd = (Get-Location).Path) {
  Invoke-Timed $PanBin $Arguments $Cwd $TimeoutSec
}

function Format-Pan([string[]]$Arguments) {
  "pan $($Arguments -join ' ')"
}

function Get-GitConfig([string]$Key) {
  $v = & git -C $ClonePath config --get $Key 2>$null
  if ($LASTEXITCODE -ne 0) { return '(unset)' }
  return ($v | Out-String).Trim()
}

function Get-HttpStatus([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$Body) {
  try {
    $params = @{ Method = $Method; Uri = $Uri; Headers = $Headers; SkipHttpErrorCheck = $true; TimeoutSec = 30 }
    if ($Body) { $params.Body = $Body }
    $r = Invoke-WebRequest @params
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = [string]$r.Content }
  } catch {
    return [pscustomobject]@{ Status = $null; Body = ($_ | Out-String) }
  }
}

# ---- environment header ---------------------------------------------------

$osCaption = if ($IsWindows) {
  try { (Get-CimInstance Win32_OperatingSystem).Caption } catch { [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }
} else { [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }
$runnerName = if ($env:ImageOS) { $env:ImageOS } else { 'local' }
$Result = [ordered]@{
  env = $EnvName
  runner = "$runnerName ($osCaption $([Environment]::OSVersion.Version))"
  node = ((& node --version 2>&1) | Out-String).Trim()
  git = ((& git --version 2>&1) | Out-String).Trim()
  subject = "$(Split-Path -Leaf $Subject) @ $(if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { 'local' })"
}

# Install the subject once; every subject step runs its pan bin.
$warmClock = [System.Diagnostics.Stopwatch]::StartNew()
$install = Invoke-Timed 'npm' @('install', '--prefix', $SubjectPrefix, '--no-audit', '--no-fund', $Subject) -TimeoutSec 900
$version = Invoke-Pan @('--version') 120
$Result.subjectInstall = [ordered]@{
  command = "npm install --prefix $SubjectPrefix --no-audit --no-fund $Subject; pan --version"
  exitCode = $install.ExitCode; evidence = (Get-Tail "$($install.Output)`n--- pan --version (exit $($version.ExitCode)) ---`n$($version.Output)")
  seconds = [Math]::Round($warmClock.Elapsed.TotalSeconds, 1)
}

# ---- 1a-1b: published latest ---------------------------------------------

Invoke-Step '1a' 'npx --yes @overdeck/core@latest --version' {
  $r = Invoke-Timed 'npx' @('--yes', '@overdeck/core@latest', '--version') -TimeoutSec 600
  $ok = $r.ExitCode -eq 0 -and $r.Output -match '\d+\.\d+\.\d+'
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); exitCode = $r.ExitCode; evidence = $r.Output }
}

Invoke-Step '1b' 'npx --yes @overdeck/core@latest vault list' {
  $r = Invoke-Timed 'npx' @('--yes', '@overdeck/core@latest', 'vault', 'list') -TimeoutSec 300
  @{ status = $(if ($r.ExitCode -eq 0) { 'pass' } else { 'fail' }); exitCode = $r.ExitCode; evidence = $r.Output
     note = 'informational: pan vault is not in the published package' }
}

# ---- 1c-2b: dashboard ------------------------------------------------------

$ServeUp = $false        # GET / answered 200
$ServeAnswers = $false   # the server answered HTTP at all; 2a/2b need only this
if ($SkipServe) {
  foreach ($id in '1c', '1d', '2a', '2b') { Add-Step $id 'not-run' '' $null '' 'skipped by -SkipServe' }
} else {
  # serve runs through the same launcher as every other step. Its output is
  # read once the tree is killed after 2b; 1c's evidence gets it then. The
  # budget is 300 s, not the PRD's 90 s: the dashboard's first boot on
  # windows-2022 was not measured yet, and a pass returns as soon as GET / is 200.
  $serve = $null
  $ServePoll = ''
  Invoke-Step '1c' "$(Format-Pan @('serve', '--port', "$Port")) (background); GET http://localhost:$Port/ (300 s budget)" {
    $env:OVERDECK_INTERNAL_TOKEN = $Token
    $script:serve = Start-Timed $PanBin @('serve', '--port', "$Port")
    Remove-Item Env:OVERDECK_INTERNAL_TOKEN -ErrorAction SilentlyContinue
    if (-not $script:serve.Process) { return @{ status = 'fail'; evidence = $script:serve.Error; note = 'serve did not start' } }
    # Stop at 200, or 30 s after the first HTTP answer of any status.
    $last = $null
    $firstAnswer = $null
    $deadline = (Get-Date).AddSeconds(300)
    while ((Get-Date) -lt $deadline) {
      $last = Get-HttpStatus 'GET' "http://localhost:$Port/" @{} $null
      if ($last.Status -eq 200) { break }
      if ($null -ne $last.Status -and -not $firstAnswer) { $firstAnswer = Get-Date }
      if ($firstAnswer -and ((Get-Date) - $firstAnswer).TotalSeconds -gt 30) { break }
      if ($script:serve.Process.HasExited) { break }
      Start-Sleep -Seconds 3
    }
    $script:ServeUp = $last.Status -eq 200
    $script:ServeAnswers = $null -ne $last.Status
    $script:ServePoll = "GET / -> $($last.Status)$(if ($last.Status -ne 200) { "`n$($last.Body)" })`n$(Get-ServeSnapshot $script:serve.Process.Id $Port)"
    $exit = if ($script:serve.Process.HasExited) { $script:serve.Process.ExitCode } else { $null }
    @{ status = $(if ($script:ServeUp) { 'pass' } else { 'fail' }); exitCode = $exit; evidence = $script:ServePoll }
  }

  Invoke-Step '2a' "GET /api/{health,conversations,projects,settings,issues} with x-overdeck-internal-token" {
    if (-not $ServeAnswers) { return @{ status = 'not-run'; note = '1c failed: the server does not answer HTTP' } }
    # Failing endpoints first, so the summary cell (first evidence line) names one.
    $bad = @()
    $good = @()
    foreach ($path in '/api/health', '/api/conversations', '/api/projects', '/api/settings', '/api/issues') {
      $r = Get-HttpStatus 'GET' "http://localhost:$Port$path" @{ 'x-overdeck-internal-token' = $Token } $null
      $body = [string]$r.Body
      $line = "$path -> $($r.Status) $($body.Substring(0, [Math]::Min(300, $body.Length)))"
      if ($r.Status -ge 200 -and $r.Status -lt 300) { $good += $line } else { $bad += $line }
    }
    @{ status = $(if ($bad.Count -eq 0) { 'pass' } else { 'fail' }); evidence = (($bad + $good) -join "`n") }
  }

  Invoke-Step '2b' "POST /api/conversations {`"message`":`"hello`"} with Origin and x-overdeck-internal-token" {
    if (-not $ServeAnswers) { return @{ status = 'not-run'; note = '1c failed: the server does not answer HTTP' } }
    $headers = @{ 'Origin' = "http://localhost:$Port"; 'x-overdeck-internal-token' = $Token; 'content-type' = 'application/json' }
    $r = Get-HttpStatus 'POST' "http://localhost:$Port/api/conversations" $headers '{"message":"hello"}'
    $ok = $r.Status -ge 200 -and $r.Status -lt 300
    @{ status = $(if ($ok) { 'pass' } else { 'fail' }); evidence = "HTTP $($r.Status)`n$($r.Body)" }
  }

  $ServeOutput = ''
  if ($serve -and $serve.Process) {
    if (-not $serve.Process.HasExited) { Stop-Tree $serve }
    $ServeOutput = Get-TimedOutput $serve
    # The poll result and snapshot go last so the 4000-character tail keeps
    # them; the serve output contributes its head (the banner) and its tail.
    # ($serveText, not $out: PowerShell names are case-insensitive and $Out is the results path.)
    $serveText = if ($ServeOutput.Length -gt 2400) { "$($ServeOutput.Substring(0, 1200))`n[...]`n$($ServeOutput.Substring($ServeOutput.Length - 1200))" } else { $ServeOutput }
    $Steps['1c'].evidence = Get-Tail "--- serve stdout+stderr ---`n$serveText`n$ServePoll"
  }

  Invoke-Step '1d' 'read serve output for "Open your browser to:"' {
    if ($ServeOutput -notmatch 'Starting server on port') {
      return @{ status = 'not-run'; evidence = $ServeOutput; note = '1c failed: serve never printed "Starting server on port"' }
    }
    $line = ($ServeOutput -split "`r?`n") | Where-Object { $_ -match 'Open your browser to:' } | Select-Object -First 1
    if ($line) { return @{ status = 'fail'; evidence = $ServeOutput; note = $line } }
    @{ status = 'partial'; evidence = $ServeOutput; note = 'headless runner: openBrowser resolved, not observable' }
  }
}

# ---- 3a-3c: vault B-flow ---------------------------------------------------

$cloneOut = (& git clone (Join-Path $Fixture 'origin.git') $ClonePath 2>&1 | Out-String)
$cloneExit = $LASTEXITCODE
$Result.clone = [ordered]@{
  path = $ClonePath; exitCode = $cloneExit; evidence = (Get-Tail $cloneOut)
  'core.autocrlf' = (Get-GitConfig 'core.autocrlf')
  'core.symlinks' = (Get-GitConfig 'core.symlinks')
  'core.filemode' = (Get-GitConfig 'core.filemode')
}

$VaultGit = Join-Path $Fixture 'vault.git'
$Passphrase = Join-Path $Fixture 'passphrase.txt'
$joinArgs = @('vault', 'join', $VaultGit, '--passphrase-file', $Passphrase)
Invoke-Step '3a' (Format-Pan $joinArgs) {
  $r = Invoke-Pan $joinArgs
  @{ status = $(if ($r.ExitCode -eq 0) { 'pass' } else { 'fail' }); exitCode = $r.ExitCode; evidence = $r.Output }
}

Invoke-Step '3b' (Format-Pan @('vault', 'list', '--json')) {
  $r = Invoke-Pan @('vault', 'list', '--json')
  $ok = $r.ExitCode -eq 0 -and $r.Output.Contains($FixtureInfo.sessionId)
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); exitCode = $r.ExitCode; evidence = $r.Output }
}

$MaterializedPath = $null
$NewSessionId = $null
$ResumeOutput = ''
$resumeArgs = @('vault', 'resume', $FixtureInfo.vaultId, '--cwd', $ClonePath, '--no-launch', '--on-drift', 'continue')
Invoke-Step '3c' (Format-Pan $resumeArgs) {
  $r = Invoke-Pan $resumeArgs
  $script:ResumeOutput = $r.Output
  $m = [regex]::Match($r.Output, '(?m)^Materialized \d+ lines? to (.+?)\r?$')
  if ($m.Success) { $script:MaterializedPath = $m.Groups[1].Value.Trim() }
  $c = [regex]::Match($r.Output, "claude --resume '?([0-9a-fA-F-]{36})")
  if ($c.Success) { $script:NewSessionId = $c.Groups[1].Value }
  $ok = $r.ExitCode -eq 0 -and $m.Success -and $c.Success
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); exitCode = $r.ExitCode; evidence = $r.Output }
}

# ---- homes, used by 3d-3f --------------------------------------------------

$NodeHome = ((& node -p "require('os').homedir()" 2>&1) | Out-String).Trim()
$UserHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $NodeHome }
$ClaudeProjects = Join-Path $UserHome '.claude' 'projects'
$OverdeckHome = if ($env:OVERDECK_HOME) { $env:OVERDECK_HOME } else { Join-Path $NodeHome '.overdeck' }

Invoke-Step '3d' "inspect the materialized transcript printed by 3c" {
  if (-not $MaterializedPath) { return @{ status = 'not-run'; note = '3c failed: no "Materialized ... to <path>" line' } }
  $lines = @("path: $MaterializedPath", "expected under: $ClaudeProjects")
  $exists = Test-Path -LiteralPath $MaterializedPath
  $lines += "exists: $exists"
  $full = [IO.Path]::GetFullPath($MaterializedPath)
  $under = $full.StartsWith([IO.Path]::GetFullPath($ClaudeProjects) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
  $lines += "under projects root: $under"
  $lines += "directory name: $(Split-Path -Leaf (Split-Path -Parent $full))"
  $cwdOk = $false
  if ($exists) {
    $cwds = Get-Content -LiteralPath $MaterializedPath | Where-Object { $_.Trim() } | ForEach-Object { ($_ | ConvertFrom-Json).cwd }
    $bad = @($cwds | Where-Object { $_ -ne $ClonePath })
    $cwdOk = $cwds.Count -gt 0 -and $bad.Count -eq 0
    $lines += "line cwds: $((@($cwds) | Select-Object -Unique) -join ' | ')"
    $lines += "clone path: $ClonePath"
  }
  @{ status = $(if ($exists -and $under -and $cwdOk) { 'pass' } else { 'fail' }); evidence = ($lines -join "`n") }
}

# ---- 4a-4f: the applied code snapshot (before anything launches claude) ------

Invoke-Step '4a' 'code snapshot outcome printed by 3c' {
  $line = ($ResumeOutput -split "`r?`n") | Where-Object { $_ -match 'code snapshot' } | Select-Object -First 1
  $ok = $ResumeOutput -match 'Applied code snapshot'
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); evidence = $(if ($line) { $line } else { $ResumeOutput });
     note = $(if ($ok) { '' } else { 'no "Applied code snapshot" line' }) }
}

Invoke-Step '4b' 'compare lf.txt, git log and notes-untracked.txt with fixture.json' {
  $lines = @()
  $lfPath = Join-Path $ClonePath 'lf.txt'
  $lf = if (Test-Path -LiteralPath $lfPath) { [IO.File]::ReadAllText($lfPath) } else { $null }
  $lfOk = $null -ne $lf -and ($lf -replace "`r`n", "`n") -eq $FixtureInfo.expected.'lf.txt'
  $lines += "lf.txt matches after LF normalization: $lfOk ($(if ($null -eq $lf) { 'missing' } else { ($lf | ConvertTo-Json) }))"
  $log = (& git -C $ClonePath log --format=%s 2>&1 | Out-String)
  $logOk = $log.Contains($FixtureInfo.expected.unpushedSubject)
  $lines += "git log contains '$($FixtureInfo.expected.unpushedSubject)': $logOk"
  $lines += $log.Trim()
  $untrackedOk = Test-Path -LiteralPath (Join-Path $ClonePath 'notes-untracked.txt')
  $lines += "notes-untracked.txt exists: $untrackedOk"
  @{ status = $(if ($lfOk -and $logOk -and $untrackedOk) { 'pass' } else { 'fail' }); evidence = ($lines -join "`n") }
}

Invoke-Step '4c' "git status --porcelain in $ClonePath" {
  $porcelain = (& git -C $ClonePath status --porcelain 2>&1 | Out-String)
  $code = $LASTEXITCODE
  $actual = @(($porcelain -split "`r?`n") | Where-Object { $_.Length -gt 3 } | ForEach-Object { $_.Substring(3) } | Sort-Object)
  $expected = @($FixtureInfo.expected.changedPaths | Sort-Object)
  $ok = $code -eq 0 -and (($actual -join "`n") -eq ($expected -join "`n"))
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); exitCode = $code
     evidence = "$porcelain`nexpected paths: $($expected -join ', ')`nactual paths: $($actual -join ', ')" }
}

Invoke-Step '4d' 'CRLF counts of lf.txt and crlf.txt' {
  $counts = @{}
  $lines = @("core.autocrlf: $($Result.clone.'core.autocrlf')")
  foreach ($name in 'lf.txt', 'crlf.txt') {
    $path = Join-Path $ClonePath $name
    if (-not (Test-Path -LiteralPath $path)) { $counts[$name] = $null; $lines += "${name}: missing"; continue }
    $bytes = [IO.File]::ReadAllBytes($path)
    $crlf = 0
    for ($i = 1; $i -lt $bytes.Length; $i++) { if ($bytes[$i] -eq 10 -and $bytes[$i - 1] -eq 13) { $crlf++ } }
    $counts[$name] = $crlf
    $lines += "${name}: $($bytes.Length) bytes, $crlf CRLF, hex $([Convert]::ToHexString($bytes))"
  }
  if ($null -eq $counts['lf.txt'] -or $null -eq $counts['crlf.txt']) {
    return @{ status = 'fail'; evidence = ($lines -join "`n"); note = 'lf.txt or crlf.txt is missing' }
  }
  $ok = $counts['lf.txt'] -eq 0 -and $counts['crlf.txt'] -eq 2
  @{ status = $(if ($ok) { 'pass' } else { 'partial' }); evidence = ($lines -join "`n")
     note = $(if ($ok) { '' } else { 'line endings differ from the Linux working tree (lf.txt 0 CRLF, crlf.txt 2 CRLF)' }) }
}

Invoke-Step '4e' 'git ls-files -s run.sh (staged into a scratch index)' {
  # The snapshot arrives unstaged, so run.sh is untracked; stage it into a
  # scratch index to read the mode git records without touching the clone's.
  $index = Join-Path $ProbeTemp 'exec-bit.index'
  $env:GIT_INDEX_FILE = $index
  try {
    & git -C $ClonePath read-tree HEAD 2>&1 | Out-Null
    $add = (& git -C $ClonePath add -- run.sh 2>&1 | Out-String)
    $ls = (& git -C $ClonePath ls-files -s -- run.sh 2>&1 | Out-String).Trim()
  } finally {
    Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  }
  $mode = if ($ls -match '^(\d{6}) ') { $Matches[1] } else { '(none)' }
  $evidence = "core.filemode: $($Result.clone.'core.filemode')`n$add$ls"
  @{ status = $(if ($mode -eq '100755') { 'pass' } else { 'fail' }); evidence = $evidence; note = "mode $mode" }
}

Invoke-Step '4f' 'link-to-lf is a symlink?' {
  $path = Join-Path $ClonePath 'link-to-lf'
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return @{ status = 'fail'; evidence = "core.symlinks: $($Result.clone.'core.symlinks')`nlink-to-lf is missing" } }
  $linkType = [string]$item.LinkType
  $evidence = "core.symlinks: $($Result.clone.'core.symlinks')`nLinkType: $linkType`nTarget: $($item.Target)`nAttributes: $($item.Attributes)"
  if ($linkType -eq 'SymbolicLink') { return @{ status = 'pass'; evidence = $evidence } }
  $content = [IO.File]::ReadAllText($path)
  @{ status = 'partial'; evidence = "$evidence`ncontent: $($content | ConvertTo-Json)"; note = 'link-to-lf is a plain file, not a symlink' }
}

# ---- 3e-3g: Claude Code ------------------------------------------------------

Invoke-Step '3e' "claude --resume <3c id> -p ping; claude --resume $ZeroSession -p ping (in $ClonePath, 60 s each)" {
  if (-not $NewSessionId) { return @{ status = 'not-run'; note = '3c failed: no new session id' } }
  $a = Invoke-Timed 'claude' @('--resume', $NewSessionId, '-p', 'ping') $ClonePath 60
  $b = Invoke-Timed 'claude' @('--resume', $ZeroSession, '-p', 'ping') $ClonePath 60
  $projects = if (Test-Path -LiteralPath $ClaudeProjects) { (Get-ChildItem -LiteralPath $ClaudeProjects -Directory | ForEach-Object Name) -join "`n" } else { '(missing)' }
  $evidence = "--- resume $NewSessionId (exit $($a.ExitCode)) ---`n$($a.Output)`n--- resume $ZeroSession (exit $($b.ExitCode)) ---`n$($b.Output)`n--- $ClaudeProjects ---`n$projects"
  if (-not $a.Started) { return @{ status = 'fail'; exitCode = $a.ExitCode; evidence = $evidence; note = 'claude did not start' } }
  $norm = { param($t) (($t -replace [regex]::Escape($NewSessionId), '<id>') -replace [regex]::Escape($ZeroSession), '<id>') -replace '\s+', ' ' }
  if ((& $norm $a.Output).Trim() -ne (& $norm $b.Output).Trim()) {
    return @{ status = 'pass'; exitCode = $a.ExitCode; evidence = $evidence; note = 'outputs differ between the materialized id and a random id' }
  }
  if ($a.Output -match 'No conversation found') {
    return @{ status = 'fail'; exitCode = $a.ExitCode; evidence = $evidence; note = 'Claude Code did not find the materialized session' }
  }
  @{ status = 'partial'; exitCode = $a.ExitCode; evidence = $evidence
     note = "file path matches Overdeck's slug; pickup not exercised: no Claude credentials in CI" }
}

Invoke-Step '3f' 'record HOME, USERPROFILE, os.homedir(), OVERDECK_HOME and the materialized path' {
  $vaultDir = Join-Path $OverdeckHome 'vault'
  $lines = @(
    "HOME: $env:HOME", "USERPROFILE: $env:USERPROFILE", "os.homedir(): $NodeHome",
    "OVERDECK_HOME: $OverdeckHome (vault dir exists: $(Test-Path -LiteralPath $vaultDir))",
    "materialized: $MaterializedPath"
  )
  $prefix = [IO.Path]::GetFullPath($NodeHome) + [IO.Path]::DirectorySeparatorChar
  $inHome = { param($p) $p -and ([IO.Path]::GetFullPath($p)).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }
  $ok = (Test-Path -LiteralPath $vaultDir) -and (& $inHome $vaultDir) -and (& $inHome $MaterializedPath)
  @{ status = $(if ($ok) { 'pass' } else { 'fail' }); evidence = ($lines -join "`n") }
}

$launchArgs = @('vault', 'resume', $FixtureInfo.vaultId, '--cwd', $ClonePath, '--on-drift', 'continue')
Invoke-Step '3g' "$(Format-Pan $launchArgs) (launches claude; 120 s, stdin closed)" {
  # After 3c adopted the session this machine owns it, so resume prints nothing
  # of its own before spawning claude: any output is claude's or a spawn error.
  if (-not $NewSessionId) { return @{ status = 'not-run'; note = '3c failed: the session was not adopted' } }
  $r = Invoke-Pan $launchArgs 120 $ClonePath
  if ($r.Output -match 'EINVAL|ENOENT|spawn .*claude') {
    return @{ status = 'fail'; exitCode = $r.ExitCode; evidence = $r.Output; note = 'spawn error' }
  }
  $text = ($r.Output -replace '\[probe: killed after \d+ s\]', '').Trim()
  if ($text) { return @{ status = 'pass'; exitCode = $r.ExitCode; evidence = $r.Output; note = 'claude produced output' } }
  if ($r.TimedOut) { return @{ status = 'partial'; evidence = $r.Output; note = 'no output within 120 s' } }
  @{ status = 'fail'; exitCode = $r.ExitCode; evidence = $r.Output; note = 'exited without output' }
}

Add-Step '5a' 'not-run' '' $null '' 'native env'

# ---- cascade: steps whose subject never happened ---------------------------
# Their evidence stays (the plain clone's bytes, the homes); the status says why.

if (-not $MaterializedPath -and $Steps['3f'].status -ne 'not-run') {
  $Steps['3f'].status = 'not-run'
  $Steps['3f'].note = '3c failed: nothing was materialized'
}
if ($Steps['4a'].status -ne 'pass') {
  foreach ($id in '4b', '4c', '4d', '4e', '4f') {
    $Steps[$id].status = 'not-run'
    $Steps[$id].note = '4a failed: the code snapshot was not applied'
  }
}

# ---- write -----------------------------------------------------------------

$ordered = foreach ($id in $Catalogue.Keys) {
  if ($Steps.Contains($id)) { $Steps[$id] } else {
    [ordered]@{ id = $id; status = 'not-run'; command = ''; exitCode = $null; evidence = ''; note = 'the probe did not reach this step'; seconds = $null }
  }
}
$Result.steps = @($ordered)
$json = $Result | ConvertTo-Json -Depth 8
New-Item -ItemType Directory -Force -Path (Split-Path -Parent ([IO.Path]::GetFullPath($Out))) | Out-Null
[IO.File]::WriteAllText([IO.Path]::GetFullPath($Out), $json, [Text.UTF8Encoding]::new($false))
Write-Host "wrote $Out"
foreach ($s in $Result.steps) { Write-Host ("{0,-3} {1,-8} {2}" -f $s.id, $s.status, $s.note) }
