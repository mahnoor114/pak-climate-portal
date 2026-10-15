<#
Makes the portal start by itself whenever you log in to Windows, then starts it now.

  powershell -ExecutionPolicy Bypass -File install_autostart.ps1 [-OpenBrowserAtLogin]

What it sets up (no administrator rights needed):
  - %LOCALAPPDATA%\PakClimatePortal\launcher.ps1 - waits (up to 10 min) for this folder to be reachable,
    since a mapped network drive like Z: can appear a little after login, then runs run_portal.ps1.
  - A hidden-window shortcut to that launcher in your Startup folder.
Undo with uninstall_autostart.ps1.
#>
param([switch]$OpenBrowserAtLogin)

$Root     = $PSScriptRoot
$AppDir   = Join-Path $env:LOCALAPPDATA 'PakClimatePortal'
$Launcher = Join-Path $AppDir 'launcher.ps1'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Pakistan Climate Portal.lnk'
$Shell    = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $Shell) { $Shell = (Get-Command powershell).Source }

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
$browserArg = if ($OpenBrowserAtLogin) { ' -OpenBrowser' } else { '' }
@"
# Written by install_autostart.ps1 - starts the Pakistan Climate portal at login.
`$root = '$($Root -replace "'", "''")'
for (`$i = 0; `$i -lt 120 -and -not (Test-Path (Join-Path `$root 'run_portal.ps1')); `$i++) { Start-Sleep 5 }
if (Test-Path (Join-Path `$root 'run_portal.ps1')) {
    & (Join-Path `$root 'run_portal.ps1')$browserArg
} else {
    "`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  Portal folder not reachable after 10 minutes: `$root" |
        Add-Content (Join-Path '$($AppDir -replace "'", "''")' 'launcher.log')
}
"@ | Set-Content -Path $Launcher -Encoding utf8

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($Shortcut)
$lnk.TargetPath       = $Shell
$lnk.Arguments        = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`""
$lnk.WorkingDirectory = $AppDir
$lnk.WindowStyle      = 7   # minimized; -WindowStyle Hidden then hides it
$lnk.Description      = 'Starts the Pakistan Climate portal (http://localhost:8000)'
$lnk.Save()

Write-Host "Autostart installed:"
Write-Host "  launcher : $Launcher"
Write-Host "  shortcut : $Shortcut"
Write-Host "  browser at login: $([bool]$OpenBrowserAtLogin)"

# Start it now as well (hidden), so you don't have to log out and in.
Start-Process -FilePath $Shell -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`"" -WindowStyle Hidden
Write-Host "Portal starting in the background - open http://localhost:8000/ in about 30 seconds."
