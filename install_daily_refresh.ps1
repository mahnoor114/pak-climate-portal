<#
Makes sure the portal fetches fresh weather every day, even when this PC is asleep: a scheduled task wakes the PC
daily (default 06:00) and runs wake_refresh.ps1, which keeps it awake until the weather, air-quality and wind
data are refreshed, then lets it sleep again.
  - Wakes only on mains power (wake timers are allowed for "plugged in" only), never on battery.
  - Can't wake a PC that is shut down; it runs at the next start instead.
  - Runs the local copy of wake_refresh.ps1 that the portal watchdog keeps in
    %LOCALAPPDATA%\PakClimatePortal\app, so it doesn't depend on the network drive after waking.
  powershell -ExecutionPolicy Bypass -File install_daily_refresh.ps1 [-At 06:00]
  powershell -ExecutionPolicy Bypass -File install_daily_refresh.ps1 -Remove
#>
param([string]$At = '06:00', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$TaskName = 'Pakistan Climate Portal - daily refresh'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed the task '$TaskName'. (Wake timers stay allowed on mains power; other tasks may use them.)"
    exit 0
}

$App = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\app'
$Script = Join-Path $App 'wake_refresh.ps1'
New-Item -ItemType Directory -Force -Path $App | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'wake_refresh.ps1') $Script -Force  # first copy now; the watchdog keeps it current

# Allow wake timers when plugged in (Windows' default there is "important wake timers only", which skips this task)
powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /setactive SCHEME_CURRENT

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Wakes the PC so the Pakistan Climate portal can refresh its weather, air-quality and wind data, then lets it sleep.' -Force | Out-Null
Write-Host "Installed: '$TaskName' wakes this PC daily at $At (when plugged in) to refresh the portal's data."
Write-Host "Log: $env:LOCALAPPDATA\PakClimatePortal\logs\daily_refresh.log"
