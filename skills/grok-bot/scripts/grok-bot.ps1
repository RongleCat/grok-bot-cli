# Launch bin/grok-bot.mjs from this skill. Windows PowerShell 5.1+.
# Prefer Node.js 22.13+ on PATH, then Bun. If neither is present, install
# Bun into the user directory (BUN_INSTALL or %USERPROFILE%\.bun) and run that exe.
# Progress goes to stderr so --json keeps stdout for the CLI.
# No &&, ||, ??, or ternary: those need PowerShell 7.

$ErrorActionPreference = 'Continue'
# PowerShell 7 can turn a native non-zero exit into a terminating error.
# Assigning $false is a no-op on Windows PowerShell 5.1, which has no such preference.
$PSNativeCommandUseErrorActionPreference = $false

$wantJson = $false
foreach ($a in @($args)) {
  if ("$a" -eq '--json') { $wantJson = $true }
}
$userArgs = @($args)

function Write-Fail {
  param([string]$Code, [string]$Message)
  [Console]::Error.WriteLine("${Code}: $Message")
  if ($script:wantJson) {
    $esc = $Message.Replace('\', '\\').Replace('"', '\"')
    [Console]::Out.WriteLine(('{"ok":false,"error":{"code":"' + $Code + '","message":"' + $esc + '"}}'))
  }
  exit 3
}

function Write-ManualHints {
  [Console]::Error.WriteLine(@'
Install Node.js 22 LTS (22.13 or newer) or Bun, then run this command again.
Node.js:
  macOS:   brew install node
  Windows: winget install OpenJS.NodeJS.LTS
  Linux:   distro package, nvm, or fnm
  https://nodejs.org/en/download
Bun (user directory, no administrator):
  macOS/Linux: curl -fsSL https://bun.sh/install | bash
  Windows:     powershell -c "irm bun.sh/install.ps1 | iex"
  https://bun.sh
'@)
}

function Test-VersionRequest {
  foreach ($a in $script:userArgs) {
    if ($a -eq '--version' -or $a -eq '-V' -or $a -eq 'version') { return $true }
  }
  return $false
}

function Resolve-LauncherFile {
  param([string]$Path)
  $current = $Path
  if (-not [System.IO.Path]::IsPathRooted($current)) {
    $current = Join-Path (Get-Location).Path $current
  }
  $i = 0
  while ($i -lt 20) {
    $i++
    if (-not (Test-Path -LiteralPath $current)) { return $current }
    $item = Get-Item -LiteralPath $current -Force
    $target = $null
    $prop = $item.PSObject.Properties['Target']
    if ($null -ne $prop -and $null -ne $prop.Value -and "$($prop.Value)" -ne '') {
      $raw = $prop.Value
      if ($raw -is [System.Array]) { $raw = $raw[0] }
      $target = [string]$raw
    }
    $reparse = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
    if (-not $reparse -and -not $target) { return $item.FullName }
    if (-not $target -and $reparse) {
      $parent = Split-Path -Parent $item.FullName
      $leaf = $item.Name
      $listing = & cmd.exe /d /c "dir /a `"$parent`""
      foreach ($line in @($listing)) {
        $text = [string]$line
        if ($text.Contains($leaf) -and $text -match '\[(.+)\]\s*$') {
          $target = $Matches[1]
          break
        }
      }
    }
    if (-not $target) { return $item.FullName }
    if (-not [System.IO.Path]::IsPathRooted($target)) {
      $target = Join-Path (Split-Path -Parent $item.FullName) $target
    }
    $current = $target
  }
  Write-Fail 'RUNTIME_INSTALL_FAILED' 'Could not resolve the launcher path.'
}

function Find-CommandPath {
  param([string]$Name)
  $cmd = Get-Command -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $cmd) { return $null }
  if ($cmd.Source) { return [string]$cmd.Source }
  if ($cmd.Path) { return [string]$cmd.Path }
  return $null
}

function Test-NodeVersionAtLeast {
  param([string]$NodePath)
  $raw = & $NodePath --version 2>$null
  if (-not $raw) { return $false }
  $text = "$(@($raw) | Select-Object -First 1)".Trim()
  if ($text.StartsWith('v')) { $text = $text.Substring(1) }
  if ($text -notmatch '^(\d+)\.(\d+)(?:\.(\d+))?') { return $false }
  $major = [int]$Matches[1]
  $minor = [int]$Matches[2]
  if ($major -gt 22) { return $true }
  if ($major -lt 22) { return $false }
  if ($minor -ge 13) { return $true }
  return $false
}

function Set-BunInstallDir {
  if ($env:BUN_INSTALL) { return }
  if (-not $env:USERPROFILE) {
    Write-ManualHints
    Write-Fail 'RUNTIME_INSTALL_FAILED' 'USERPROFILE is not set, so Bun cannot be installed into a user directory. See stderr for commands.'
  }
  $env:BUN_INSTALL = Join-Path $env:USERPROFILE '.bun'
}

function Find-BunDefault {
  Set-BunInstallDir
  $exe = Join-Path (Join-Path $env:BUN_INSTALL 'bin') 'bun.exe'
  if (Test-Path -LiteralPath $exe) { return $exe }
  $plain = Join-Path (Join-Path $env:BUN_INSTALL 'bin') 'bun'
  if (Test-Path -LiteralPath $plain) { return $plain }
  return $null
}

function Install-Bun {
  if ($env:GROK_BOT_NO_AUTO_INSTALL -eq '1') {
    [Console]::Error.WriteLine('grok-bot: automatic install is off (GROK_BOT_NO_AUTO_INSTALL=1).')
    Write-ManualHints
    Write-Fail 'RUNTIME_INSTALL_FAILED' 'Automatic install is off (GROK_BOT_NO_AUTO_INSTALL=1). Install Node.js 22.13 or newer, or Bun 1.1 or newer. See stderr for commands.'
  }
  Set-BunInstallDir
  $log = Join-Path $env:TEMP ("grok-bot-bun-" + [Guid]::NewGuid().ToString() + ".log")
  $env:GROK_BOT_BUN_LOG = $log
  [Console]::Error.WriteLine("grok-bot: installing Bun into $($env:BUN_INSTALL) (user directory, no administrator). This needs network and can take a while.")
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm bun.sh/install.ps1 | iex *>&1 | Out-File -FilePath $env:GROK_BOT_BUN_LOG -Encoding utf8'
  $installStatus = $LASTEXITCODE
  if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log | ForEach-Object { [Console]::Error.WriteLine($_) }
    Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:GROK_BOT_BUN_LOG -ErrorAction SilentlyContinue
  if ($installStatus -ne 0) {
    [Console]::Error.WriteLine("grok-bot: the Bun installer exited $installStatus.")
    Write-ManualHints
    Write-Fail 'RUNTIME_INSTALL_FAILED' 'The Bun installer failed. See stderr for the installer output and for manual Node.js 22 LTS or Bun commands.'
  }
  $found = Find-BunDefault
  if (-not $found) {
    [Console]::Error.WriteLine("grok-bot: the installer finished but bun was not found under $($env:BUN_INSTALL)\bin.")
    Write-ManualHints
    Write-Fail 'RUNTIME_INSTALL_FAILED' 'The Bun installer finished, but the bun binary was not found. See stderr for manual install commands.'
  }
}

function Test-Checksum {
  param([string]$MjsPath, [string]$SumsPath)
  if (-not (Test-Path -LiteralPath $MjsPath) -or -not (Test-Path -LiteralPath $SumsPath)) {
    Write-Fail 'CLI_CHECKSUM_MISMATCH' 'grok-bot.mjs or SHA256SUMS is missing from the skill bin directory.'
  }
  $line = "$(@(Get-Content -LiteralPath $SumsPath -TotalCount 1) | Select-Object -First 1)"
  $expected = (($line -split '\s+')[0]).Trim().ToLowerInvariant()
  $actual = $null
  try {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $MjsPath).Hash.ToLowerInvariant()
  } catch {
    $actual = $null
  }
  if (-not $actual) {
    $cert = Get-Command certutil -ErrorAction SilentlyContinue
    if ($cert) {
      $output = & certutil.exe -hashfile $MjsPath SHA256
      foreach ($row in @($output)) {
        $compact = ("$row" -replace '\s', '')
        if ($compact -match '^[0-9A-Fa-f]{64}$') {
          $actual = $compact.ToLowerInvariant()
          break
        }
      }
    }
  }
  if (-not $actual) {
    if (Test-VersionRequest) {
      [Console]::Error.WriteLine('grok-bot: skipped the SHA-256 check; Get-FileHash and certutil were not available.')
    }
    return
  }
  if ($expected -ne $actual) {
    Write-Fail 'CLI_CHECKSUM_MISMATCH' 'grok-bot.mjs does not match SHA256SUMS.'
  }
}

$entry = $PSCommandPath
if (-not $entry) { $entry = $MyInvocation.MyCommand.Path }
if (-not $entry) { Write-Fail 'RUNTIME_INSTALL_FAILED' 'Could not resolve the launcher path.' }
$scriptFile = Resolve-LauncherFile $entry
$scriptDir = Split-Path -Parent $scriptFile
$binDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\bin'))
$mjs = Join-Path $binDir 'grok-bot.mjs'
$sums = Join-Path $binDir 'SHA256SUMS'
Test-Checksum -MjsPath $mjs -SumsPath $sums

$force = ''
if ($env:GROK_BOT_RUNTIME) { $force = $env:GROK_BOT_RUNTIME.Trim() }
$chosen = $null

if ($force -eq '') {
  $node = Find-CommandPath 'node'
  if (-not $node) { $node = Find-CommandPath 'node.exe' }
  if ($node -and (Test-NodeVersionAtLeast $node)) { $chosen = $node }
  if (-not $chosen) {
    $bun = Find-CommandPath 'bun'
    if (-not $bun) { $bun = Find-CommandPath 'bun.exe' }
    if ($bun) { $chosen = $bun }
  }
  if (-not $chosen) { $chosen = Find-BunDefault }
  if (-not $chosen) {
    Install-Bun
    $chosen = Find-BunDefault
  }
} elseif ($force -eq 'node') {
  $chosen = Find-CommandPath 'node'
  if (-not $chosen) { $chosen = Find-CommandPath 'node.exe' }
  if (-not $chosen) {
    [Console]::Error.WriteLine('grok-bot: GROK_BOT_RUNTIME=node but node is not on PATH.')
    Write-ManualHints
    Write-Fail 'RUNTIME_INSTALL_FAILED' 'GROK_BOT_RUNTIME=node but node was not found on PATH. See stderr for install commands.'
  }
} elseif ($force -eq 'bun') {
  $chosen = Find-CommandPath 'bun'
  if (-not $chosen) { $chosen = Find-CommandPath 'bun.exe' }
  if (-not $chosen) { $chosen = Find-BunDefault }
  if (-not $chosen) {
    Install-Bun
    $chosen = Find-BunDefault
  }
} else {
  [Console]::Error.WriteLine('grok-bot: GROK_BOT_RUNTIME must be node or bun.')
  Write-Fail 'RUNTIME_INSTALL_FAILED' 'GROK_BOT_RUNTIME must be node or bun.'
}

if (-not $chosen) {
  Write-ManualHints
  Write-Fail 'RUNTIME_INSTALL_FAILED' 'No supported JavaScript runtime is available. See stderr for Node.js 22 LTS and Bun install commands.'
}

& $chosen $mjs @userArgs
# Capture immediately. A later command would replace $LASTEXITCODE.
# This wrapper already forwards the CLI status. The Windows case where a
# TIMEOUT (exit 5) became status 1 was process.exit() while a libuv handle
# was closing, before this script could see code 5.
$cliExit = $LASTEXITCODE
if ($null -eq $cliExit) { exit 0 }
exit $cliExit
