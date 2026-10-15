@echo off
rem Double-click to open the Pakistan Climate portal in your browser (starts it first if needed).
title Pakistan Climate Portal
echo Opening the Pakistan Climate portal...
powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/ai-status -TimeoutSec 3 | Out-Null; exit 0}catch{exit 1}"
if %errorlevel%==0 goto open

echo Starting the portal - this takes about 30 seconds...
if exist "%LOCALAPPDATA%\PakClimatePortal\launcher.ps1" (
  start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\PakClimatePortal\launcher.ps1"
) else (
  start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0run_portal.ps1"
)
powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/api/ai-status -TimeoutSec 3 | Out-Null; exit 0}catch{Start-Sleep 2}}; exit 1"
if errorlevel 1 (
  echo.
  echo The portal did not start within 3 minutes.
  echo Details: %LOCALAPPDATA%\PakClimatePortal\logs\watchdog.log
  pause
  exit /b 1
)

:open
start "" "http://localhost:8000/"