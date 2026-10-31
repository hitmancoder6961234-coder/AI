<#
.SYNOPSIS
  Creates an SSH key pair, installs the public key on your server, and proves key-based login works.

.DESCRIPTION
  1. Generates an Ed25519 key in ~/.ssh (never overwrites an existing key).
  2. Connects ONCE with your password to append the PUBLIC key to ~/.ssh/authorized_keys.
     The password is typed at ssh's own prompt. It is never stored, never written to a file and never
     passed on a command line, so it cannot leak into shell history or logs.
  3. Tests login with the key and password authentication disabled.
  4. Optionally adds a Host entry to ~/.ssh/config.

  After this, deploy with scripts/deploy-server.ps1 (key only - no password needed again).
  Disabling password login on the server is a manual, deliberate step: see the last lines of output.

.EXAMPLE
  .\scripts\setup-ssh-key.ps1 -HostName 203.0.113.10 -User ham
  .\scripts\setup-ssh-key.ps1 -HostName server.example.com -User ham -AddToSshConfig
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][string]$User,
  [ValidateRange(1, 65535)][int]$Port = 22,
  [string]$KeyName = 'darkness_ed25519',
  [switch]$AddToSshConfig
)

$ErrorActionPreference = 'Stop'

function Test-HostName([string]$name) {
  # A dotted run of digits must be a real IPv4 address (catches typos such as 10.0.1216.5).
  if ($name -match '^\d+(\.\d+){1,}$') {
    $ip = $null
    if (-not [System.Net.IPAddress]::TryParse($name, [ref]$ip) -or $name.Split('.').Count -ne 4) {
      throw "'$name' is not a valid IPv4 address. Each of the four parts must be 0-255 (check for a mistyped part)."
    }
    return
  }
  if ($name -notmatch '^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$') {
    throw "'$name' is not a valid host name."
  }
}

if ($User -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw "'$User' does not look like a valid Unix user name." }
Test-HostName $HostName

foreach ($tool in 'ssh', 'ssh-keygen') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool not found. Install the Windows 'OpenSSH Client' optional feature (Settings > Apps > Optional features)."
  }
}

$sshDir = Join-Path $HOME '.ssh'
if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }
$keyPath = Join-Path $sshDir $KeyName
$pubPath = "$keyPath.pub"

# --- 1. key pair ---------------------------------------------------------------------------------
if (Test-Path $keyPath) {
  Write-Host "Key already exists, reusing it: $keyPath" -ForegroundColor Yellow
} else {
  Write-Host "Creating Ed25519 key: $keyPath" -ForegroundColor Cyan
  Write-Host "Choose a passphrase when asked (recommended). It protects the key if your PC is ever compromised."
  & ssh-keygen -t ed25519 -a 64 -f $keyPath -C "darkness-deploy@$env:COMPUTERNAME"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $keyPath)) { throw 'ssh-keygen failed.' }
}

# Windows OpenSSH refuses private keys that other accounts can read.
& icacls $keyPath /inheritance:r | Out-Null
& icacls $keyPath /grant:r "$($env:USERNAME):(R,W)" | Out-Null

$pub = (Get-Content $pubPath -Raw).Trim()
if ($pub -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$') { throw 'Public key file looks malformed.' }

# --- 2. install the public key (password is typed at ssh's own prompt) ---------------------------
Write-Host ''
Write-Host "Installing the public key on $User@$HostName (port $Port)." -ForegroundColor Cyan
Write-Host 'ssh will show the server fingerprint the first time: compare it with your provider before typing "yes".'
Write-Host 'Then enter your server password at the prompt. It is not stored anywhere.' -ForegroundColor Yellow

$remote = "umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qxF '$pub' ~/.ssh/authorized_keys || echo '$pub' >> ~/.ssh/authorized_keys; echo KEY_INSTALLED"
& ssh -p $Port -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no "$User@$HostName" $remote
if ($LASTEXITCODE -ne 0) { throw 'Could not install the key (wrong password, host unreachable, or password login disabled).' }

# --- 3. prove key login works --------------------------------------------------------------------
Write-Host ''
Write-Host 'Testing key-only login...' -ForegroundColor Cyan
$check = & ssh -p $Port -i $keyPath -o IdentitiesOnly=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no "$User@$HostName" 'echo KEY_LOGIN_OK'
if ($LASTEXITCODE -ne 0 -or ($check -notmatch 'KEY_LOGIN_OK')) {
  throw 'Key login failed. The public key was copied, but the server did not accept it (check ~/.ssh permissions and sshd_config PubkeyAuthentication).'
}
Write-Host 'Key login works.' -ForegroundColor Green

# --- 4. optional ssh config entry ----------------------------------------------------------------
if ($AddToSshConfig) {
  $cfg = Join-Path $sshDir 'config'
  $alias = 'darkness-server'
  $exists = (Test-Path $cfg) -and ((Get-Content $cfg -Raw) -match "(?m)^Host\s+$alias\s*$")
  if ($exists) {
    Write-Host "~/.ssh/config already has a '$alias' entry, leaving it alone." -ForegroundColor Yellow
  } else {
    $block = "`r`nHost $alias`r`n  HostName $HostName`r`n  User $User`r`n  Port $Port`r`n  IdentityFile ~/.ssh/$KeyName`r`n  IdentitiesOnly yes`r`n"
    Add-Content -Path $cfg -Value $block -Encoding ascii
    Write-Host "Added 'ssh $alias' to ~/.ssh/config." -ForegroundColor Green
  }
}

Write-Host ''
Write-Host 'Next steps' -ForegroundColor Cyan
Write-Host "  Deploy:   .\scripts\deploy-server.ps1 -HostName $HostName -User $User -Port $Port -KeyName $KeyName"
Write-Host '  Harden:   once you have confirmed key login in a SECOND terminal, set these in /etc/ssh/sshd_config'
Write-Host '            on the server, then run: sudo systemctl reload ssh'
Write-Host '              PasswordAuthentication no'
Write-Host '              PermitRootLogin no'
Write-Host '  Your password was never saved. Change it if it was ever shared in chat, email or a ticket.' -ForegroundColor Yellow
