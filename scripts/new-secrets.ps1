<#
.SYNOPSIS
  Generates the cryptographic secrets Darkness AI needs, using the OS random number generator.

.DESCRIPTION
  Produces PRIVACY_ENCRYPTION_KEY (32 random bytes, base64). It encrypts anything mirrored to Aiven
  and lets you rotate nothing but this one value. Output is written to .secrets\secrets.env, which is
  git-ignored and ACL-restricted to your Windows account. Nothing is printed unless you pass -Show.

  Paste the value into your host's environment variables (Render / Vercel / .env on your server).
  LOSING THIS KEY MAKES MIRRORED DATA UNREADABLE - keep a copy in your password manager.

.EXAMPLE
  .\scripts\new-secrets.ps1
  .\scripts\new-secrets.ps1 -Show
#>
[CmdletBinding()]
param(
  [switch]$Show,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

function New-RandomBase64([int]$bytes) {
  $buf = New-Object 'byte[]' $bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buf) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($buf)
}

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root '.secrets'
$file = Join-Path $dir 'secrets.env'

if ((Test-Path $file) -and -not $Force) {
  throw "$file already exists. Re-run with -Force to replace it (this would orphan data encrypted with the old key)."
}
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

$key = New-RandomBase64 32
Set-Content -Path $file -Value "PRIVACY_ENCRYPTION_KEY=$key" -Encoding ascii

# Restrict the file to the current user only.
& icacls $dir /inheritance:r | Out-Null
& icacls $dir /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null

Write-Host "Wrote $file (git-ignored, readable only by $env:USERNAME)." -ForegroundColor Green
if ($Show) { Write-Host "PRIVACY_ENCRYPTION_KEY=$key" } else { Write-Host 'Open the file to copy the value, or re-run with -Show.' }
Write-Host 'Store a backup in your password manager. Never commit, chat or e-mail this value.' -ForegroundColor Yellow
