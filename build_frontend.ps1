<#
Builds the React frontend (.\frontend) into .\dist, which the portal server serves at http://<host>:8000/.
Run it after changing anything in .\frontend; the running portal picks up the new .\dist within 10 minutes
(or straight away after Stop portal / Start portal).

npm is far too slow on the network drive (thousands of small files), so the source is copied to a local
build folder (%LOCALAPPDATA%\PakClimatePortal\frontend-build), installed and built there, and only the
finished .\dist is written back here. Needs Node.js (https://nodejs.org).
  powershell -ExecutionPolicy Bypass -File build_frontend.ps1
#>
$ErrorActionPreference = 'Stop'
$Src  = Join-Path $PSScriptRoot 'frontend'
$Out  = Join-Path $PSScriptRoot 'dist'
$Work = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\frontend-build'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm not found - install Node.js from https://nodejs.org first.' }

# Mirror the source (node_modules stays local: /XD keeps it from being copied or purged)
New-Item -ItemType Directory -Force $Work | Out-Null
robocopy $Src $Work /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the frontend source failed (robocopy code $LASTEXITCODE)." }

Push-Location $Work
try {
    npm install --no-audit --no-fund
    if ($LASTEXITCODE) { throw 'npm install failed.' }
    npx vite build --outDir $Out --emptyOutDir
    if ($LASTEXITCODE) { throw 'Build failed.' }
} finally { Pop-Location }
# keep the lock file with the source so every build installs the same package versions
Copy-Item (Join-Path $Work 'package-lock.json') (Join-Path $Src 'package-lock.json') -Force
Write-Host "Built: $Out"
