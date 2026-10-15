<#
Deploy step of the CI/CD pipeline (.github/workflows/ci-cd.yml). Runs on the portal PC, through a GitHub
self-hosted runner, after CI has built and tested a push to main:
  1. Brings the portal folder (the master copy run_portal.ps1 runs from) up to the pushed commit with a
     fast-forward git merge. It never overwrites work: if the folder has unpushed commits, or uncommitted
     changes to files the push touches, the deploy stops and says so.
  2. Installs the frontend CI built (dist/).
  3. Restarts the portal and waits until it serves this build (health check); the deploy fails otherwise.

One-time setup on the portal PC:
  - GitHub repo > Settings > Actions > Runners > New self-hosted runner (Windows). Follow the download and
    config steps, adding the label "portal" when asked for labels. Run it as the user who runs the portal
    (the portal folder, its git credentials and %LOCALAPPDATA%\PakClimatePortal belong to that user):
    start run.cmd at login, or install the service with that user's account (not NETWORK SERVICE).
  - GitHub repo > Settings > Secrets and variables > Actions > Variables: PORTAL_DIR = the portal folder as a
    UNC path (background processes can't see mapped drives such as Z:), e.g.
    \\172.18.7.21\GIS Share\Tech(EW)\Mahnoor Haider\Natasha
  - The portal folder's git remote "origin" must be the GitHub repo.

By hand (same as the pipeline):
  powershell -ExecutionPolicy Bypass -File deploy_portal.ps1 -PortalDir <folder> -Dist <built dist> -Commit <sha>
#>
param(
    [Parameter(Mandatory)][string]$PortalDir,
    [Parameter(Mandatory)][string]$Dist,
    [Parameter(Mandatory)][string]$Commit
)
$ErrorActionPreference = 'Stop'
$Port = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }
function Step([string]$Text) { Write-Host "==> $Text" }

if (-not $PortalDir) { throw 'PORTAL_DIR is not set (GitHub repo > Settings > Secrets and variables > Actions > Variables).' }
if (-not (Test-Path (Join-Path $PortalDir 'run_portal.ps1'))) { throw "Portal folder not found or not reachable: $PortalDir" }
if (-not (Test-Path (Join-Path $Dist 'index.html'))) { throw "No built frontend in $Dist" }

# 1. Portal folder -> pushed commit. safe.directory: the folder is on a network share, whose files git sees as
#    owned by another user.
$git = @('-c', 'safe.directory=*', '-C', $PortalDir)
Step "Updating $PortalDir to $($Commit.Substring(0, 7))"
& git @git fetch --quiet origin
if ($LASTEXITCODE) { throw 'git fetch failed - check the folder''s remote "origin" and this user''s GitHub credentials.' }
& git @git merge --ff-only --quiet $Commit
if ($LASTEXITCODE) {
    throw ('The portal folder can''t be fast-forwarded to this commit: it has commits that were not pushed, or ' +
           'uncommitted changes to files this push changes. Push or commit them, then re-run the deploy.')
}

# 2. The built frontend (dist/ is not in git; CI builds it)
Step 'Installing the built frontend'
robocopy $Dist (Join-Path $PortalDir 'dist') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying dist failed (robocopy code $LASTEXITCODE)." }

# 3. Restart: the watchdog copies the folder to its local working copy on start, so the new code runs at once.
Step 'Restarting the portal'
& (Join-Path $PortalDir 'stop_portal.ps1')
$launcher = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\launcher.ps1'
$entry = if (Test-Path $launcher) { $launcher } else { Join-Path $PortalDir 'run_portal.ps1' }
# The runner ends every process a job leaves behind; an empty tracking id keeps the portal running after the job.
$env:RUNNER_TRACKING_ID = ''
Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$entry`""

# Health check: the page must reference this build's script, and the API must answer.
$want = [regex]::Match((Get-Content (Join-Path $Dist 'index.html') -Raw), '/assets/[^"]+\.js').Value
Step "Waiting for the portal to serve $want"
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
    Start-Sleep 10
    try {
        $page = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/" -TimeoutSec 10
        if ($page.Content.Contains($want)) {
            Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port$want" -TimeoutSec 10 | Out-Null
            Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/ai-status" -TimeoutSec 10 | Out-Null
            Step "Deployed $($Commit.Substring(0, 7)): http://localhost:$Port/"
            exit 0
        }
    } catch { }  # still starting
}
throw "The portal did not come back with this build within 5 minutes. Logs: $env:LOCALAPPDATA\PakClimatePortal\logs"
