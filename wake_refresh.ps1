<#
Daily refresh while the PC would otherwise be asleep. The scheduled task from install_daily_refresh.ps1 wakes the
PC every morning and runs this script, which keeps it awake until the portal has refreshed its weather forecast,
air-quality and wind data (they are saved to its cache and the database as they arrive), then lets it sleep again.
The portal's own refresh threads do the downloading; this only keeps the PC awake long enough for them to run.
Log: %LOCALAPPDATA%\PakClimatePortal\logs\daily_refresh.log
  powershell -ExecutionPolicy Bypass -File wake_refresh.ps1
#>
param([int]$TimeoutMinutes = 30)

$Port = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }
$LogDir = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'daily_refresh.log'
function Write-Log([string]$Message) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -Path $Log -Encoding utf8 }

# Tell Windows the system is in use (ES_CONTINUOUS | ES_SYSTEM_REQUIRED) so it doesn't go back to sleep meanwhile.
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[Win32.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

$datasets = 'pakforecast', 'aqmap', 'wind'  # weather forecast grid, air quality grid, upper-level wind
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$fetched = @{}
Write-Log 'Woke for the daily refresh.'
try {
    while ($true) {
        $pending = @()
        foreach ($d in $datasets) {
            try {
                $js = Invoke-RestMethod "http://127.0.0.1:$Port/api/$d" -TimeoutSec 30
                if ($js.stale) { $pending += $d } else { $fetched[$d] = $js.fetched }
            } catch { $pending += $d }  # portal still starting up, or no data yet
        }
        if (-not $pending) {
            Start-Sleep 30  # the database writes run on a background queue; give them a moment
            Write-Log ('Data is fresh: ' + (($datasets | ForEach-Object { "$_ $($fetched[$_])" }) -join ', ') + '.')
            break
        }
        if ((Get-Date) -gt $deadline) {
            Write-Log "Gave up after $TimeoutMinutes minutes; still waiting for: $($pending -join ', '). The portal retries on its own while the PC is awake."
            exit 1
        }
        Start-Sleep 30
    }
} finally {
    [Win32.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null  # back to normal: the PC may sleep again
}
