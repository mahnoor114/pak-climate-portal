<#
Saves the current state of the portal: a new version in the history (git) and a dated backup zip in .\backups.
API keys (groc api.txt, *.key, .env), logs and temporary files are never included (see .gitignore).
  powershell -ExecutionPolicy Bypass -File save_version.ps1 ["what changed"]
#>
param([string]$Message)

Set-Location $PSScriptRoot
git add -A 2>$null
if (git diff --cached --name-only) {
    if (-not $Message) { $Message = "Saved version $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    git commit -q -m $Message
    Write-Host "Saved new version: $(git log --oneline -1)"
} else {
    Write-Host 'No changes since the last saved version.'
}

# Backup zip of exactly the saved files (same exclusions as the history).
New-Item -ItemType Directory -Force backups | Out-Null
$zip   = "backups\Pakistan_Climate_Portal_$(Get-Date -Format 'yyyy-MM-dd_HHmm').zip"
$stage = Join-Path $env:TEMP "pcp_backup_$(Get-Random)"
New-Item -ItemType Directory $stage | Out-Null
foreach ($f in git ls-files) {
    $dst = Join-Path $stage $f
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item -LiteralPath $f -Destination $dst
}
Compress-Archive -Path "$stage\*" -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force
Write-Host "Backup: $((Get-Item $zip).FullName)"
