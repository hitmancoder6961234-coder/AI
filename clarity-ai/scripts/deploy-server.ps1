<#
.SYNOPSIS
  Deploys Darkness AI to your own Docker server over SSH using your key (no password).

.DESCRIPTION
  On the server this will: clone/update the repo, check that ~/darkness-ai/.env exists, then run
  `docker compose up -d --build`. Secrets live only in that .env on the server - this script never
  reads, sends or logs them. Create the key first with scripts/setup-ssh-key.ps1.

.EXAMPLE
  .\scripts\deploy-server.ps1 -HostName 203.0.113.10 -User ham
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][string]$User,
  [ValidateRange(1, 65535)][int]$Port = 22,
  [string]$KeyName = 'darkness_ed25519',
  [string]$RepoUrl = 'https://github.com/hitmancoder6961234-coder/AI.git',
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

if ($HostName -match '^\d+(\.\d+)+$') {
  $ip = $null
  if (-not [System.Net.IPAddress]::TryParse($HostName, [ref]$ip) -or $HostName.Split('.').Count -ne 4) {
    throw "'$HostName' is not a valid IPv4 address."
  }
}
if ($RepoUrl -notmatch '^https://[A-Za-z0-9._~/-]+(\.git)?$') { throw 'RepoUrl must be a plain https:// URL.' }
if ($Branch -notmatch '^[A-Za-z0-9._/-]+$') { throw 'Branch contains unexpected characters.' }

$keyPath = Join-Path (Join-Path $HOME '.ssh') $KeyName
if (-not (Test-Path $keyPath)) { throw "Key not found: $keyPath. Run scripts/setup-ssh-key.ps1 first." }

$remoteScript = @"
set -euo pipefail
APP_DIR="`$HOME/darkness-ai"
mkdir -p "`$APP_DIR"
cd "`$APP_DIR"
if [ -d repo/.git ]; then
  git -C repo fetch --depth 1 origin '$Branch'
  git -C repo reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch '$Branch' '$RepoUrl' repo
fi
if [ ! -f "`$APP_DIR/.env" ]; then
  echo "MISSING `$APP_DIR/.env - create it from repo/clarity-ai/.env.example (chmod 600), then re-run." >&2
  exit 2
fi
chmod 600 "`$APP_DIR/.env"
cd repo/clarity-ai
ln -sf "`$APP_DIR/.env" .env
docker compose up -d --build
docker compose ps
echo DEPLOY_OK
"@ -replace "`r`n", "`n"

Write-Host "Deploying to $User@$HostName (key: $KeyName)..." -ForegroundColor Cyan
$out = $remoteScript | & ssh -p $Port -i $keyPath -o IdentitiesOnly=yes -o PasswordAuthentication=no "$User@$HostName" 'bash -s'
$out | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0 -or ($out -notmatch 'DEPLOY_OK')) { throw 'Deployment did not complete. See the output above.' }
Write-Host 'Deployed. The app listens on 127.0.0.1:3000 on the server - point your TLS reverse proxy at it (deploy/server/Caddyfile.example).' -ForegroundColor Green
