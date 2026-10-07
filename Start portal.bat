@echo off
rem Starts the portal (kept running and restarted automatically) and opens it in the browser.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0run_portal.ps1\" -OpenBrowser'"
echo Portal starting - your browser opens in about 30 seconds.
timeout /t 4 >nul
