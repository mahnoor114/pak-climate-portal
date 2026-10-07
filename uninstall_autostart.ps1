<#
Stops the portal and removes the login autostart created by install_autostart.ps1.
  powershell -ExecutionPolicy Bypass -File uninstall_autostart.ps1
#>
& (Join-Path $PSScriptRoot 'stop_portal.ps1')
$Shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Pakistan Climate Portal.lnk'
$AppDir   = Join-Path $env:LOCALAPPDATA 'PakClimatePortal'
Remove-Item $Shortcut -Force -ErrorAction SilentlyContinue
Remove-Item $AppDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Autostart removed. Start the portal by hand with run_portal.ps1 (or python portal_server.py).'
