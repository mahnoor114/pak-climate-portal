@echo off
rem Stops the portal and removes the login autostart.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall_autostart.ps1"
pause
