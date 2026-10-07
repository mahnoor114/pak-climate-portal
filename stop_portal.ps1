<#
Stops the running portal and its watchdog (it will start again at next login if autostart is installed).
  powershell -ExecutionPolicy Bypass -File stop_portal.ps1
#>
$Port = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }

# The watchdog first, so it doesn't restart the server we are about to stop.
$watchdogs = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'run_portal\.ps1|PakClimatePortal\\launcher\.ps1' }
foreach ($w in $watchdogs) { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "Stopped watchdog (PID $($w.ProcessId))" }

$servers = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $servers) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host "Stopped portal server (PID $id)" }
if (-not $watchdogs -and -not $servers) { Write-Host 'The portal was not running.' }
